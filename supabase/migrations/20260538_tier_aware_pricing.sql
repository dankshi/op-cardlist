-- ============================================
-- TIER-AWARE PRICING
-- Adds seller tier + lifetime GMV tracking, listing fulfillment method,
-- and per-component fee breakdown on orders. Powers calculatePayout()
-- in src/lib/fees.ts.
-- ============================================

-- 1. Sellers track their current tier + lifetime GMV.
--    Tier defaults to 'basic' and bumps automatically as GMV grows
--    (see src/app/api/stripe/webhooks/route.ts on order paid).
ALTER TABLE profiles
  ADD COLUMN seller_tier TEXT NOT NULL DEFAULT 'basic'
    CHECK (seller_tier IN ('basic', 'silver', 'pearl', 'gold', 'diamond', 'elite'));

ALTER TABLE profiles
  ADD COLUMN seller_gmv NUMERIC(12,2) NOT NULL DEFAULT 0;

CREATE INDEX idx_profiles_seller_tier ON profiles(seller_tier)
  WHERE is_seller = TRUE;

COMMENT ON COLUMN profiles.seller_tier IS
  'Current pricing tier. See src/lib/fees.ts for the GMV → tier mapping.';
COMMENT ON COLUMN profiles.seller_gmv IS
  'Lifetime gross merchandise value in USD. Bumped on each paid order.';

-- 2. Listings record how the seller is delivering the card to the buyer.
--    Drives whether the $5 seller fee applies and whether P2P pricing kicks in.
ALTER TABLE listings
  ADD COLUMN fulfillment_method TEXT NOT NULL DEFAULT 'ship'
    CHECK (fulfillment_method IN ('ship', 'drop', 'p2p'));

CREATE INDEX idx_listings_fulfillment ON listings(fulfillment_method)
  WHERE status = 'active';

COMMENT ON COLUMN listings.fulfillment_method IS
  'How the card reaches the buyer: ship (mailed to Nomi), drop (in-person dropoff), p2p (direct buyer-to-seller, Elite tier only).';

-- 3. Order-level fee breakdown for transparency in seller dashboards.
--    platform_fee stays as the rolled-up total Nomi collects
--    (seller_fee + marketplace_fee), so the existing webhook email and any
--    downstream code keep working unchanged.
ALTER TABLE orders
  ADD COLUMN seller_fee NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders
  ADD COLUMN marketplace_fee NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders
  ADD COLUMN processing_fee NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders
  ADD COLUMN seller_tier_at_sale TEXT
    CHECK (seller_tier_at_sale IS NULL OR seller_tier_at_sale IN ('basic', 'silver', 'pearl', 'gold', 'diamond', 'elite'));

COMMENT ON COLUMN orders.seller_fee IS
  'Per-card seller fee charged on Ship-to-Nomi listings.';
COMMENT ON COLUMN orders.marketplace_fee IS
  'Tier-based percentage fee Nomi collects on the sale.';
COMMENT ON COLUMN orders.processing_fee IS
  'Payment processing fee (flat 3%) passed through from Stripe.';
COMMENT ON COLUMN orders.seller_tier_at_sale IS
  'Snapshot of the seller tier when the order was placed, so the fee math is auditable even if the seller later tiers up.';
