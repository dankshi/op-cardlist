-- Card mappings table for storing TCGPlayer mappings and art styles
-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS card_mappings (
  card_id TEXT PRIMARY KEY,
  tcgplayer_product_id INTEGER NOT NULL,
  tcgplayer_url TEXT NOT NULL,
  tcgplayer_name TEXT NOT NULL,
  market_price DECIMAL(10, 2),
  art_style TEXT, -- 'manga', 'alternate', 'wanted', 'standard'
  submitted_by TEXT,
  approved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_card_mappings_approved ON card_mappings(approved);
CREATE INDEX IF NOT EXISTS idx_card_mappings_product_id ON card_mappings(tcgplayer_product_id);

-- Function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to auto-update updated_at on row changes
DROP TRIGGER IF EXISTS update_card_mappings_updated_at ON card_mappings;
CREATE TRIGGER update_card_mappings_updated_at
  BEFORE UPDATE ON card_mappings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security
ALTER TABLE card_mappings ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read approved mappings
CREATE POLICY "Anyone can read approved mappings"
  ON card_mappings FOR SELECT
  USING (approved = true);

-- Policy: Anyone can insert new mappings (they'll be unapproved by default)
CREATE POLICY "Anyone can submit mappings"
  ON card_mappings FOR INSERT
  WITH CHECK (true);

-- Policy: Only service role can update/approve mappings
-- (You'll use the service role key for admin operations)
CREATE POLICY "Service role can update all"
  ON card_mappings FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Grant permissions
GRANT SELECT ON card_mappings TO anon;
GRANT INSERT ON card_mappings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON card_mappings TO authenticated;
