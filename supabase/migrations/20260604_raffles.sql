-- ============================================
-- RAFFLES
-- v1: launch raffle for OP13 booster box. Entry rules:
--   - 1 free entry per signed-in user per raffle (manual claim)
--   - 1 entry per CARD purchased in an authenticated order (buyer side)
--   - 1 entry per CARD sold in an authenticated order (seller side)
--
-- A "card" = one unit of order_item.quantity. Most listings are
-- unique-card so quantity=1, but the rule generalizes if a seller ever
-- lists a sealed product with multiple units.
--
-- Entries are inserted server-side from the order-authentication hooks
-- (clean and legacy paths) and from the free-entry endpoint. No
-- user-side insert policy — RLS only exposes read access.
-- ============================================

CREATE TABLE IF NOT EXISTS raffles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  prize_description TEXT NOT NULL,
  prize_image_url TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'drawn', 'cancelled')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  drawn_at TIMESTAMPTZ,
  winner_user_id UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_raffles_status ON raffles(status);

CREATE TABLE IF NOT EXISTS raffle_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raffle_id UUID NOT NULL REFERENCES raffles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('signup', 'purchase', 'sale')),
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  order_item_id UUID REFERENCES order_items(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One free entry per user per raffle. Partial unique index — purchase
-- and sale entries can stack arbitrarily.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_raffle_signup
  ON raffle_entries(raffle_id, user_id)
  WHERE source = 'signup';

CREATE INDEX IF NOT EXISTS idx_raffle_entries_user
  ON raffle_entries(raffle_id, user_id);
CREATE INDEX IF NOT EXISTS idx_raffle_entries_order
  ON raffle_entries(order_id) WHERE order_id IS NOT NULL;

-- ----- RLS -----
ALTER TABLE raffles ENABLE ROW LEVEL SECURITY;
ALTER TABLE raffle_entries ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Raffles are world-readable" ON raffles
    FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins manage raffles" ON raffles
    FOR ALL
    USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
    WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users read own entries" ON raffle_entries
    FOR SELECT USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins manage entries" ON raffle_entries
    FOR ALL
    USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
    WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----- Seed: OP13 launch raffle -----
-- Draw date: end of day 2026-06-30 Pacific. (Idempotent end-date set
-- lives in the follow-up migration 20260605 so we can adjust the date
-- without re-running this file.)
INSERT INTO raffles (slug, title, prize_description, prize_image_url, status, ends_at)
VALUES (
  'op13-launch',
  'OP13 Booster Box Launch Raffle',
  'One sealed OP13 booster box',
  '/homeBanner/op13_banner.webp',
  'active',
  '2026-06-30 23:59:59-07'
)
ON CONFLICT (slug) DO NOTHING;
