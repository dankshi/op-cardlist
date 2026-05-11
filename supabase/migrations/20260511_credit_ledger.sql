-- ============================================
-- CREDIT LEDGER
-- Immutable record of every credit movement for a user.
-- profiles.balance remains the denormalized running total of *available* credits.
-- Pending credits (sold but not yet authenticated) are computed on the fly from orders.
-- ============================================

CREATE TYPE credit_transaction_type AS ENUM (
  'sale_earned',
  'purchase_spent',
  'cashout',
  'refund_credit',
  'admin_adjust'
);

CREATE TABLE credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL,
  type credit_transaction_type NOT NULL,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT credit_amount_nonzero CHECK (amount <> 0),
  CONSTRAINT credit_amount_sign_matches_type CHECK (
    CASE type
      WHEN 'sale_earned'    THEN amount > 0
      WHEN 'refund_credit'  THEN amount > 0
      WHEN 'purchase_spent' THEN amount < 0
      WHEN 'cashout'        THEN amount < 0
      WHEN 'admin_adjust'   THEN amount <> 0
    END
  )
);

CREATE INDEX idx_credit_txns_user_created ON credit_transactions(user_id, created_at DESC);
CREATE INDEX idx_credit_txns_order ON credit_transactions(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX idx_credit_txns_type ON credit_transactions(type);

ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own credit transactions"
  ON credit_transactions FOR SELECT
  USING (user_id = auth.uid());

-- Inserts/updates/deletes happen via service role only (server routes).
GRANT SELECT ON credit_transactions TO authenticated;

COMMENT ON TABLE credit_transactions IS
  'Immutable ledger of credit movements. profiles.balance is the denormalized running total of available credits. Pending credits are derived from orders.status IN (paid, seller_shipped, received) for the seller.';

-- Track how much of an order was paid using credits (rest charged to card via Stripe).
ALTER TABLE orders ADD COLUMN credits_applied NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD CONSTRAINT orders_credits_applied_nonneg CHECK (credits_applied >= 0);
