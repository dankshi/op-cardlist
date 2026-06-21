-- ============================================
-- CONSIGNMENT FLOW (unified model)
-- One consignment model for every way a card ends up nomi-listed on a
-- seller's behalf. The card stays the SELLER's property until it sells;
-- nomi receives, verifies, photographs, prices, lists (under the seller's
-- profile), and credits the seller the proceeds minus a commission.
--
-- Three origins, one data model (the `channel` column):
--   * ship_in    — seller pre-builds a manifest online, then mails the batch
--   * drop_off   — admin scans the seller in person and adds cards live
--   * exception  — an order hit an authentication exception (wrong card,
--                  condition downgrade, seller-attributable damage); rather
--                  than ship a low-value card back, nomi consigns it. Same
--                  economics as the other two (seller keeps proceeds minus
--                  fee), just an involuntary entry point.
--
-- This SUPERSEDES `consigned_intakes` (20260603_authentication_flow.sql),
-- which modeled only the exception origin as a separate table. That table is
-- migrated into consignment_submissions/items and dropped at the end of this
-- migration. The exception write-path (finalize-auth) and the admin
-- post-exception inventory UI now read/write these tables instead.
--
-- `buyouts` (also from 20260603) is UNCHANGED — that's the genuinely
-- nomi-owned bucket (courier/nomi-attributable damage we pay the seller for),
-- which is a different thing from consignment.
--
-- See designs/consignment-flow.md (stakeholder rationale) and
-- docs/consignment-flow.md (lifecycle + endpoint contract).
-- ============================================

-- ----- 1. consignment_submissions -----
-- TEXT + CHECK for status (matches the intake_status / auth_decision
-- convention) so we can evolve the value list without ALTER TYPE locks.
CREATE TABLE IF NOT EXISTS consignment_submissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id       UUID NOT NULL REFERENCES profiles(id),
  channel         TEXT NOT NULL CHECK (channel IN ('ship_in', 'drop_off', 'exception')),
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','awaiting_shipment','in_transit',
                                      'received','processing','listed','closed')),
  submission_code TEXT,                     -- scannable batch code/QR; assigned by trigger below
  fee_bps         INTEGER,                  -- snapshot of the seller's consignment commission (basis points)
                                            --   one rate regardless of origin; taken at lock time so later
                                            --   tier changes don't move past payouts
  origin_order_id UUID REFERENCES orders(id),  -- set for channel='exception': the order that produced it
  shippo_label_id TEXT,                     -- inbound insured label (ship_in)
  tracking_number TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at    TIMESTAMPTZ,             -- manifest locked (ship_in)
  received_at     TIMESTAMPTZ,
  closed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_consignment_submissions_seller ON consignment_submissions(seller_id);
CREATE INDEX IF NOT EXISTS idx_consignment_submissions_status ON consignment_submissions(status);
-- One exception-origin submission per order (groups all of an order's
-- flagged cards). Partial: ship_in/drop_off rows have a null origin_order_id.
CREATE UNIQUE INDEX IF NOT EXISTS idx_consignment_submissions_origin_order
  ON consignment_submissions(origin_order_id) WHERE origin_order_id IS NOT NULL;

COMMENT ON TABLE consignment_submissions IS
  'One consignment batch. channel = how it started (ship_in | drop_off | exception). Cards stay the seller''s property until sold. Supersedes the exception-only consigned_intakes table.';

-- ----- 2. submission code generator -----
-- 'C-' prefix + 8 Crockford Base32 chars. The prefix lets the admin scan
-- resolver distinguish a batch QR from a seller QR (a UUID), a product_id
-- (9 bare chars), or a triage_code ('T-' prefix). Same collision-retry
-- approach as gen_product_id (20260606): RNG quality is irrelevant; the
-- retry loop + unique index guarantee uniqueness.
CREATE OR REPLACE FUNCTION gen_consignment_code() RETURNS TEXT AS $$
DECLARE
  alphabet CONSTANT TEXT := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  result TEXT := 'C-';
  i INT;
BEGIN
  FOR i IN 1..8 LOOP
    result := result || substr(alphabet, floor(random() * 32)::int + 1, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql VOLATILE;

CREATE OR REPLACE FUNCTION set_consignment_submission_code() RETURNS TRIGGER AS $$
DECLARE
  candidate TEXT;
BEGIN
  IF NEW.submission_code IS NOT NULL THEN
    RETURN NEW;
  END IF;
  LOOP
    candidate := gen_consignment_code();
    EXIT WHEN NOT EXISTS (SELECT 1 FROM consignment_submissions WHERE submission_code = candidate);
  END LOOP;
  NEW.submission_code := candidate;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE UNIQUE INDEX IF NOT EXISTS idx_consignment_submissions_code
  ON consignment_submissions(submission_code);

DROP TRIGGER IF EXISTS trg_consignment_submission_code ON consignment_submissions;
CREATE TRIGGER trg_consignment_submission_code
  BEFORE INSERT ON consignment_submissions
  FOR EACH ROW
  EXECUTE FUNCTION set_consignment_submission_code();

-- ----- 3. consignment_items -----
-- One card within a batch. For ship_in/drop_off, `declared_*` = the seller's
-- claim and `actual_*` = what intake verified; a material mismatch flips
-- status to 'discrepancy'. For exception-origin items, the card is already in
-- hand (it came in on the order), so they start at 'confirmed' and carry
-- origin_order_item_id + exception_type back to the triggering order.
--
-- card_condition is the existing enum (20260226_create_marketplace.sql).
-- Grading company stays TEXT + CHECK to match the collections convention.
CREATE TABLE IF NOT EXISTS consignment_items (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id        UUID NOT NULL REFERENCES consignment_submissions(id) ON DELETE CASCADE,
  seller_id            UUID NOT NULL REFERENCES profiles(id),   -- denormalized for RLS + seller-hub queries
  card_id              TEXT,                -- set at manifest (ship_in) or at confirm (drop_off/exception)
  kind                 TEXT NOT NULL CHECK (kind IN ('raw','slab')),

  -- exception origin (null for seller-initiated items)
  origin_order_item_id UUID REFERENCES order_items(id),
  exception_type       TEXT,                -- e.g. incorrect_product | conditional | physical_damage

  -- what the seller declared
  declared_condition   card_condition,      -- raw only
  declared_company     TEXT CHECK (declared_company IS NULL OR declared_company IN ('PSA','CGC','BGS','TAG')),
  declared_grade       TEXT,                -- slab only
  declared_cert        TEXT,                -- slab only

  -- what intake verified (null until confirmed)
  actual_condition     card_condition,
  actual_company       TEXT CHECK (actual_company IS NULL OR actual_company IN ('PSA','CGC','BGS','TAG')),
  actual_grade         TEXT,
  actual_cert          TEXT,

  -- scannable label code, assigned at CONFIRM (not insert): ship_in items
  -- start 'expected' with no physical card. App generates via gen_product_id()
  -- (shared code space with order_items); the partial unique index below is
  -- the backstop. Nullable until a card is physically in hand.
  product_id           TEXT,
  suggested_price      NUMERIC(10,2),       -- snapshot from raw/slab market value at confirm
  ask_price            NUMERIC(10,2),       -- chosen list price (a.k.a. relist price for exception origin)
  reserve_price        NUMERIC(10,2),       -- optional floor
  listing_id           UUID REFERENCES listings(id) ON DELETE SET NULL,
  photo_urls           TEXT[] NOT NULL DEFAULT '{}',
  notes                TEXT,

  status               TEXT NOT NULL DEFAULT 'expected'
                         CHECK (status IN ('expected','received','confirmed',
                                           'discrepancy','listed','sold','returned','rejected')),
  discrepancy_kind     TEXT CHECK (discrepancy_kind IS NULL OR
                         discrepancy_kind IN ('condition','wrong_card','counterfeit','not_received','other')),
  discrepancy_note     TEXT,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at         TIMESTAMPTZ,
  listed_at            TIMESTAMPTZ,
  resolved_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_consignment_items_submission   ON consignment_items(submission_id);
CREATE INDEX IF NOT EXISTS idx_consignment_items_seller       ON consignment_items(seller_id);
CREATE INDEX IF NOT EXISTS idx_consignment_items_status       ON consignment_items(status);
CREATE INDEX IF NOT EXISTS idx_consignment_items_listing      ON consignment_items(listing_id);
CREATE INDEX IF NOT EXISTS idx_consignment_items_origin_item  ON consignment_items(origin_order_item_id)
  WHERE origin_order_item_id IS NOT NULL;

-- product_id unique only among assigned (confirmed) items. Cross-table
-- collisions with order_items.product_id are caught by re-rolling at the
-- app layer at confirm time (check both tables before assigning); the astro-
-- nomically rare same-code case fails this index loudly rather than silently.
CREATE UNIQUE INDEX IF NOT EXISTS idx_consignment_items_product_id
  ON consignment_items(product_id) WHERE product_id IS NOT NULL;

COMMENT ON TABLE consignment_items IS
  'One card in a consignment batch. declared_* = seller''s claim; actual_* = intake-verified. Exception-origin items carry origin_order_item_id + exception_type. On sale, settlement splits proceeds using the parent submission''s fee_bps.';
COMMENT ON COLUMN consignment_items.product_id IS
  'Short label/QR code (shares the order_items.product_id code space). Assigned at confirm via gen_product_id(); check order_items + consignment_items for collisions before assigning.';

-- ----- 4. listings.source -----
-- Lets fulfillment skip the seller-ship leg for consignment sales (card is
-- already in nomi's hands) and lets reporting separate consignment GMV.
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'seller'
    CHECK (source IN ('seller','consignment'));

-- ----- 5. migrate consigned_intakes -> unified tables, then drop it -----
-- consigned_intakes (20260603) modeled only the exception origin. Fold every
-- existing row into one exception-channel submission per order + one item.
-- Status map: pending_relist->confirmed, listed->listed, sold->sold,
-- written_off->rejected. Defensive: a no-op when the table is empty.
DO $$
DECLARE
  r RECORD;
  v_order_id UUID;
  v_card_id  TEXT;
  v_sub_id   UUID;
BEGIN
  IF to_regclass('public.consigned_intakes') IS NULL THEN
    RETURN;  -- already migrated / never existed
  END IF;

  FOR r IN SELECT * FROM consigned_intakes LOOP
    SELECT oi.order_id, oi.card_id INTO v_order_id, v_card_id
    FROM order_items oi WHERE oi.id = r.order_item_id;

    -- one exception submission per order (reuse if already created)
    SELECT id INTO v_sub_id
    FROM consignment_submissions
    WHERE origin_order_id = v_order_id AND channel = 'exception';

    IF v_sub_id IS NULL THEN
      INSERT INTO consignment_submissions (seller_id, channel, status, origin_order_id, created_at)
      VALUES (r.original_seller_id, 'exception', 'processing', v_order_id, r.consigned_at)
      RETURNING id INTO v_sub_id;
    END IF;

    INSERT INTO consignment_items (
      submission_id, seller_id, card_id, kind,
      origin_order_item_id, exception_type,
      ask_price, listing_id, notes, status,
      created_at, listed_at, resolved_at
    ) VALUES (
      v_sub_id, r.original_seller_id, v_card_id, 'raw',
      r.order_item_id, r.exception_type,
      r.intended_relist_price, r.consignment_listing_id, r.notes,
      CASE r.status
        WHEN 'pending_relist' THEN 'confirmed'
        WHEN 'listed'         THEN 'listed'
        WHEN 'sold'           THEN 'sold'
        WHEN 'written_off'    THEN 'rejected'
        ELSE 'confirmed'
      END,
      r.consigned_at, r.listed_at, r.resolved_at
    );
  END LOOP;
END $$;

DROP TABLE IF EXISTS consigned_intakes;

-- ----- 6. RLS -----
-- Admin-only writes (matches the old consigned_intakes policy). Sellers read
-- their own rows for transparency, and may write their own DRAFT submissions/
-- items while building a manifest.
ALTER TABLE consignment_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE consignment_items       ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Admins manage consignment_submissions" ON consignment_submissions
    FOR ALL
    USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
    WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Sellers read own consignment_submissions" ON consignment_submissions
    FOR SELECT
    USING (seller_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Sellers create own consignment_submissions" ON consignment_submissions
    FOR INSERT
    WITH CHECK (seller_id = auth.uid() AND channel IN ('ship_in','drop_off'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Sellers update own draft submissions" ON consignment_submissions
    FOR UPDATE
    USING (seller_id = auth.uid() AND status = 'draft')
    WITH CHECK (seller_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins manage consignment_items" ON consignment_items
    FOR ALL
    USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
    WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Sellers read own consignment_items" ON consignment_items
    FOR SELECT
    USING (seller_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Sellers may add/remove manifest lines only while the parent submission is
-- still a draft. The subquery scopes writes to draft batches they own.
DO $$ BEGIN
  CREATE POLICY "Sellers write items on own draft submissions" ON consignment_items
    FOR ALL
    USING (
      seller_id = auth.uid() AND EXISTS (
        SELECT 1 FROM consignment_submissions s
        WHERE s.id = consignment_items.submission_id
          AND s.seller_id = auth.uid()
          AND s.status = 'draft'
      )
    )
    WITH CHECK (
      seller_id = auth.uid() AND EXISTS (
        SELECT 1 FROM consignment_submissions s
        WHERE s.id = consignment_items.submission_id
          AND s.seller_id = auth.uid()
          AND s.status = 'draft'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
