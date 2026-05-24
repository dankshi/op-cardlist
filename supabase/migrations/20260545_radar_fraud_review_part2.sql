-- ============================================
-- RADAR FRAUD REVIEW — Part 2: columns + index + profile fields
-- The under_review enum value was added in 20260543; this migration
-- adds everything that references it. See docs/stripe-radar.md.
-- ============================================

-- 1. Per-order risk + review fields
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS stripe_review_id      TEXT,
  ADD COLUMN IF NOT EXISTS risk_score            INTEGER,
  ADD COLUMN IF NOT EXISTS risk_level            TEXT
    CHECK (risk_level IS NULL OR risk_level IN ('normal', 'elevated', 'highest', 'not_assessed')),
  ADD COLUMN IF NOT EXISTS review_opened_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_closed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_reason         TEXT,
  ADD COLUMN IF NOT EXISTS review_closed_reason  TEXT,
  ADD COLUMN IF NOT EXISTS auto_flagged_reasons  JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN orders.stripe_review_id IS
  'Stripe review object ID (rev_XXX) when Radar opens a manual review. Null if order never entered under_review.';
COMMENT ON COLUMN orders.risk_score IS
  '0-100 risk score from Stripe Radar at PaymentIntent creation. Lower is safer.';
COMMENT ON COLUMN orders.risk_level IS
  'Stripe-derived risk band: normal, elevated, highest, or not_assessed.';
COMMENT ON COLUMN orders.review_reason IS
  'Stripe-supplied reason for review (e.g. "rule", "manual"). Mirrors review.reason in the Stripe API.';
COMMENT ON COLUMN orders.review_closed_reason IS
  'Stripe-supplied outcome when the review closes: approved | refunded | refunded_as_fraud | disputed | redacted.';
COMMENT ON COLUMN orders.auto_flagged_reasons IS
  'JSON array of marketplace-specific risk signals our code flagged at order creation (self_dealing, first_listing_rush, etc). Separate from anything Stripe Radar caught.';

-- Hot index for the /admin/risk inbox query: list under_review newest-first.
-- Partial index keeps it tiny since most orders are not in this state.
CREATE INDEX IF NOT EXISTS idx_orders_under_review
  ON orders(created_at DESC) WHERE status = 'under_review';

-- 2. Last-seen tracking on profiles (powers IP-based self-dealing check
-- in src/lib/risk.ts). Populated on every session sync in src/app/auth/callback/route.ts.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS last_login_ip  INET,
  ADD COLUMN IF NOT EXISTS last_seen_at   TIMESTAMPTZ;

COMMENT ON COLUMN profiles.last_login_ip IS
  'Most recent IP address seen on session sync. Used by evaluateOrderRisk() to detect same-IP buyer/seller (self-dealing fraud).';
COMMENT ON COLUMN profiles.last_seen_at IS
  'Timestamp paired with last_login_ip — staleness check before trusting the IP for self-dealing comparison.';
