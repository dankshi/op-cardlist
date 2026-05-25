-- ============================================
-- PROFILES.BALANCE + CASHOUTS
-- 1. Adds the profiles.balance column that 20260511_credit_ledger.sql assumed
--    existed (referenced by code paths since day one of the ledger; never
--    actually created by a migration).
-- 2. Adds the cashouts table backing wallet withdrawals to bank accounts via
--    Stripe Connect Express.
-- 3. Adds increment_balance() RPC for race-safe balance restores from webhooks.
-- ============================================

-- ----- profiles.balance -----
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS balance NUMERIC(10,2) NOT NULL DEFAULT 0;

-- HEAL EXISTING DATA before applying the constraint. Two cases to handle:
--   (a) Rows where balance was hand-added but never tracked — leave alone
--       UNLESS they're negative (would violate the new constraint).
--   (b) Rows where balance = 0 but a credit_transactions ledger exists —
--       backfill from the ledger sum (clamped at 0 in case of bad data).
-- Doing it in this order is intentional: we never overwrite a non-zero
-- positive balance with a ledger sum, because some legacy rows may have
-- a balance set without corresponding ledger entries (the ledger only
-- exists since migration 20260511).
WITH ledger AS (
  SELECT user_id, GREATEST(SUM(amount), 0) AS total
  FROM credit_transactions
  GROUP BY user_id
)
UPDATE profiles p
SET balance = COALESCE(l.total, 0)
FROM ledger l
WHERE p.id = l.user_id
  AND p.balance = 0;

-- Clamp any remaining negative balances (no ledger entries to reconcile
-- against — likely a hand-edit gone wrong). Floor at 0 so the constraint
-- below can apply.
UPDATE profiles SET balance = 0 WHERE balance < 0;

ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_balance_nonneg;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_balance_nonneg CHECK (balance >= 0);

-- ----- cashouts -----
DO $$ BEGIN
  CREATE TYPE payout_method AS ENUM ('standard', 'instant');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cashout_status AS ENUM ('pending', 'paid', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS cashouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL,           -- what hits the bank
  fee NUMERIC(10,2) NOT NULL DEFAULT 0,    -- service fee retained ($1 instant, $0 standard)
  total_debited NUMERIC(10,2) NOT NULL,    -- amount + fee, what came off balance
  method payout_method NOT NULL,
  status cashout_status NOT NULL DEFAULT 'pending',
  stripe_transfer_id TEXT,                 -- platform -> connected account
  stripe_payout_id TEXT,                   -- connected account -> bank
  failure_reason TEXT,
  credit_transaction_id UUID REFERENCES credit_transactions(id),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  CONSTRAINT cashout_amount_positive CHECK (amount > 0),
  CONSTRAINT cashout_fee_nonneg CHECK (fee >= 0),
  CONSTRAINT cashout_total_matches CHECK (total_debited = amount + fee),
  CONSTRAINT cashout_min_amount CHECK (amount >= 10)
);

CREATE INDEX IF NOT EXISTS idx_cashouts_user_requested
  ON cashouts(user_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_cashouts_transfer
  ON cashouts(stripe_transfer_id) WHERE stripe_transfer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cashouts_payout
  ON cashouts(stripe_payout_id) WHERE stripe_payout_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cashouts_status
  ON cashouts(status);

ALTER TABLE cashouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own cashouts" ON cashouts;
CREATE POLICY "Users read own cashouts" ON cashouts
  FOR SELECT USING (user_id = auth.uid());

GRANT SELECT ON cashouts TO authenticated;

COMMENT ON TABLE cashouts IS
  'Wallet cashout requests. amount goes to the user bank; fee is service revenue (instant payouts). total_debited = amount + fee, mirrored as a single negative credit_transactions row of type cashout.';

-- ----- increment_balance RPC -----
-- Used by the payout.failed webhook to restore the wallet balance.
-- Service-role only; not exposed to authenticated users.
CREATE OR REPLACE FUNCTION increment_balance(p_user_id UUID, p_amount NUMERIC)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
AS $$
  UPDATE profiles SET balance = balance + p_amount WHERE id = p_user_id;
$$;

REVOKE ALL ON FUNCTION increment_balance(UUID, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION increment_balance(UUID, NUMERIC) FROM authenticated;
