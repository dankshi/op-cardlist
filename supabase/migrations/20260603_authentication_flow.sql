-- ============================================
-- AUTHENTICATION FLOW
-- Replaces the silent verify/flag pair with an explicit branching
-- decision tree: Authentic/Fake binary → Near Mint or Exceptions →
-- exception subtype + structured details. Adds:
--   1. `exception_review` order status (between received and authenticated)
--   2. Per-item auth_decision + exception columns on order_items
--   3. consigned_intakes — tracks cards that landed in Nomi inventory
--      via an exception resolution (Wrong Card, downgraded condition, etc.)
--   4. buyouts — tracks Nomi-funded payouts for damage attributable to
--      courier or our own handling (separate accounting bucket from sales)
--
-- See designs/authentication-flow.md (stakeholder rationale) and
-- docs/authentication-flow.md (state machine + endpoint contract).
-- ============================================

-- ----- 1. order_status: add exception_review -----
-- Sits between `received` and `authenticated`. Orders enter when the
-- authenticator flags anything other than a clean Authentic+NM pass.
-- Resolution routes back to `authenticated` (ship-anyway) or `cancelled`
-- (buyout-and-refund) depending on exception type.
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'exception_review' AFTER 'received';

-- ----- 2. order_items: auth_decision columns -----
-- TEXT + CHECK rather than enum to match the existing intake_status
-- convention (see 20260314_add_intake_system.sql). Lets us evolve the
-- value list without ALTER TYPE locking.

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS auth_decision TEXT NOT NULL DEFAULT 'pending'
    CHECK (auth_decision IN ('pending', 'authentic', 'fake'));

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS auth_condition TEXT
    CHECK (auth_condition IS NULL OR auth_condition IN ('near_mint', 'exception'));

-- Array column — a single item can carry multiple non-fake exceptions
-- (e.g. Wrong Card + Heavily Played). Fake is mutually exclusive with
-- the other types (enforced in app-layer validation, not here, since
-- per-element CHECKs aren't expressive enough for the rule).
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS exception_types TEXT[] NOT NULL DEFAULT '{}';

-- Discriminated JSONB keyed by exception_type. Shape per type documented
-- in docs/authentication-flow.md#exception_details-jsonb-shape.
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS exception_details JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS auth_decided_at TIMESTAMPTZ;

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS auth_decided_by UUID REFERENCES profiles(id);

-- Validate consistency: condition + exception_types must agree with
-- decision. Enforced at write time so the column trio is never in an
-- impossible state (e.g. fake + near_mint, or authentic without condition).
DO $$ BEGIN
  ALTER TABLE order_items
    ADD CONSTRAINT order_items_auth_decision_shape CHECK (
      (auth_decision = 'pending'   AND auth_condition IS NULL  AND exception_types = '{}') OR
      (auth_decision = 'authentic' AND auth_condition = 'near_mint' AND exception_types = '{}') OR
      (auth_decision = 'authentic' AND auth_condition = 'exception' AND array_length(exception_types, 1) >= 1) OR
      (auth_decision = 'fake'      AND auth_condition IS NULL  AND exception_types = ARRAY['fake']::TEXT[])
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_order_items_auth_decision
  ON order_items(auth_decision) WHERE auth_decision <> 'pending';

-- ----- 3. consigned_intakes -----
-- A row per order_item that became Nomi consignment inventory via an
-- exception. Tracks the lifecycle from "Nomi has the card" through
-- "Nomi listed it" through "Nomi sold it / wrote it off."

CREATE TABLE IF NOT EXISTS consigned_intakes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
  original_seller_id UUID NOT NULL REFERENCES profiles(id),
  exception_type TEXT NOT NULL,            -- which exception triggered this
  intended_relist_price NUMERIC(10,2),     -- ops sets when listing; null until then
  consignment_listing_id UUID REFERENCES listings(id),  -- set when relisted
  status TEXT NOT NULL DEFAULT 'pending_relist'
    CHECK (status IN ('pending_relist', 'listed', 'sold', 'written_off')),
  notes TEXT,
  consigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  listed_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_consigned_intakes_status
  ON consigned_intakes(status);
CREATE INDEX IF NOT EXISTS idx_consigned_intakes_seller
  ON consigned_intakes(original_seller_id);
CREATE INDEX IF NOT EXISTS idx_consigned_intakes_order_item
  ON consigned_intakes(order_item_id);

COMMENT ON TABLE consigned_intakes IS
  'Cards that landed in Nomi inventory via an exception resolution (Wrong Card, downgraded condition, seller-attributable damage). Lifecycle: pending_relist → listed → sold | written_off.';

-- ----- 4. buyouts -----
-- Tracks Nomi-funded seller payouts for damage attributable to courier
-- or our own handling. Distinct accounting bucket from sale earnings —
-- these are insurance claims / cost-of-goods, not revenue distribution.

CREATE TABLE IF NOT EXISTS buyouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
  seller_id UUID NOT NULL REFERENCES profiles(id),
  amount NUMERIC(10,2) NOT NULL,           -- credited to seller balance
  reason TEXT NOT NULL,                    -- "physical_damage:courier", "physical_damage:nomi"
  credit_transaction_id UUID REFERENCES credit_transactions(id),
  carrier_claim_id TEXT,                   -- e.g. Shippo claim ref
  carrier_claim_status TEXT
    CHECK (carrier_claim_status IS NULL OR
           carrier_claim_status IN ('pending', 'filed', 'paid', 'denied')),
  recovered_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recovered_at TIMESTAMPTZ,

  CONSTRAINT buyouts_amount_positive CHECK (amount > 0),
  CONSTRAINT buyouts_recovered_nonneg CHECK (recovered_amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_buyouts_seller ON buyouts(seller_id);
CREATE INDEX IF NOT EXISTS idx_buyouts_claim_status
  ON buyouts(carrier_claim_status) WHERE carrier_claim_status IS NOT NULL;

COMMENT ON TABLE buyouts IS
  'Nomi-funded payouts to sellers when an item is damaged in courier/Nomi handling. Tracks the carrier insurance claim separately so we can reconcile recovery against the original payout for accounting.';

-- ----- 5. RLS -----
ALTER TABLE consigned_intakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyouts ENABLE ROW LEVEL SECURITY;

-- Admin-only writes. Sellers can read their own rows for transparency.
DO $$ BEGIN
  CREATE POLICY "Admins manage consigned_intakes" ON consigned_intakes
    FOR ALL
    USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
    WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Sellers read own consigned_intakes" ON consigned_intakes
    FOR SELECT
    USING (original_seller_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins manage buyouts" ON buyouts
    FOR ALL
    USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
    WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Sellers read own buyouts" ON buyouts
    FOR SELECT
    USING (seller_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
