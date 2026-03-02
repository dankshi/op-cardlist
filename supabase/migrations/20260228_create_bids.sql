-- ============================================
-- BIDS: Buy offers on specific cards
-- ============================================

CREATE TYPE bid_status AS ENUM ('active', 'filled', 'cancelled', 'expired');

CREATE TABLE bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL CHECK (price > 0),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  condition_min card_condition NOT NULL DEFAULT 'near_mint',
  status bid_status NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX idx_bids_card_id ON bids(card_id) WHERE status = 'active';
CREATE INDEX idx_bids_user ON bids(user_id) WHERE status = 'active';
CREATE INDEX idx_bids_price ON bids(price DESC) WHERE status = 'active';
CREATE INDEX idx_bids_expires ON bids(expires_at) WHERE status = 'active';

-- Auto-update updated_at timestamp
CREATE TRIGGER update_bids_updated_at
  BEFORE UPDATE ON bids FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security
ALTER TABLE bids ENABLE ROW LEVEL SECURITY;

-- Anyone can see active bids (price transparency)
CREATE POLICY "Active bids are publicly readable"
  ON bids FOR SELECT
  USING (status = 'active' OR user_id = auth.uid());

-- Authenticated users can place bids
CREATE POLICY "Authenticated users can create bids"
  ON bids FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can update their own bids
CREATE POLICY "Users can update own bids"
  ON bids FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Users can delete their own bids
CREATE POLICY "Users can delete own bids"
  ON bids FOR DELETE
  USING (user_id = auth.uid());
