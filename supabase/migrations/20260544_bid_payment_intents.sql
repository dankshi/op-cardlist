-- Pre-authorize bids at placement time so Sell-into-offer captures
-- instantly. See designs/offer-flow.md for the architectural rationale.
--
-- Before: bids were "soft promises" — clicking Sell on an offer routed
-- the seller into /sell?card=X&price=Y, where they had to publish a
-- listing, and the buyer had to come back and complete a separate
-- checkout. Nothing tied the bid to the eventual purchase. Buyers could
-- disappear between offer and acceptance; the offer never auto-filled.
--
-- After: bids carry a Stripe PaymentIntent created with
-- capture_method='manual' at placement time. The buyer's card is
-- verified and funds are reserved at the issuing bank (no money
-- actually moves). When the seller accepts, we capture the PI →
-- transaction completes synchronously. When the bid is cancelled or
-- expires, we cancel the PI → the reservation drops off.
--
-- Buyers reuse saved payment methods across offers via Stripe's
-- Customer object (stripe_customer_id on profiles).

-- 1. Pre-auth payment intent per bid. NULL for legacy bids placed
--    before this migration — those continue to work via the old
--    /sell?card= routing on accept, but expire naturally without
--    being convertible to the new fast-accept flow.
ALTER TABLE bids
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT;

CREATE INDEX IF NOT EXISTS idx_bids_payment_intent
  ON bids (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

COMMENT ON COLUMN bids.stripe_payment_intent_id IS
  'Stripe PaymentIntent created with capture_method=manual at bid placement. NULL for legacy bids without pre-auth.';

-- 2. New default bid lifetime: 7 days, matching Stripe''s standard card
--    pre-authorization window. Beyond 7 days the pre-auth would lapse
--    silently — better to expire the bid in lockstep so the seller never
--    sees an "accept" button on a bid we can't actually capture.
--    Existing bids keep their original expires_at (DEFAULT only applies
--    on new INSERTs).
ALTER TABLE bids
  ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '7 days');

-- 3. Saved payment method tracking — Stripe Customer per profile so a
--    buyer's second offer doesn't re-prompt for card details. Created
--    lazily on first bid placement; nullable until then.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

CREATE INDEX IF NOT EXISTS idx_profiles_stripe_customer
  ON profiles (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

COMMENT ON COLUMN profiles.stripe_customer_id IS
  'Stripe Customer ID for saving payment methods across offers. Created on first bid placement.';
