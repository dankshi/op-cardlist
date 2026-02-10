-- Card prices table: single source of truth for TCGPlayer mappings + prices
-- Replaces the dual prices.json + card_mappings approach

CREATE TABLE IF NOT EXISTS card_prices (
  card_id TEXT PRIMARY KEY,                -- e.g., "OP13-001" or "OP13-001_p1"
  tcgplayer_product_id INTEGER,
  tcgplayer_url TEXT,
  market_price NUMERIC,
  lowest_price NUMERIC,
  median_price NUMERIC,
  total_listings INTEGER,
  last_sold_price NUMERIC,
  last_sold_date TIMESTAMPTZ,
  manually_mapped BOOLEAN DEFAULT FALSE,   -- true if mapping was set via /test page
  mapped_by TEXT,                           -- who made the manual fix
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_card_prices_product_id ON card_prices(tcgplayer_product_id);
CREATE INDEX IF NOT EXISTS idx_card_prices_manually_mapped ON card_prices(manually_mapped) WHERE manually_mapped = true;

-- Auto-update updated_at on changes
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_card_prices_updated_at ON card_prices;
CREATE TRIGGER update_card_prices_updated_at
  BEFORE UPDATE ON card_prices
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security
ALTER TABLE card_prices ENABLE ROW LEVEL SECURITY;

-- Anyone can read all prices
CREATE POLICY "Anyone can read card prices"
  ON card_prices FOR SELECT
  USING (true);

-- Anyone can insert prices (scraper + /test page)
CREATE POLICY "Anyone can insert card prices"
  ON card_prices FOR INSERT
  WITH CHECK (true);

-- Anyone can update prices (scraper + /test page)
CREATE POLICY "Anyone can update card prices"
  ON card_prices FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Grants
GRANT SELECT, INSERT, UPDATE ON card_prices TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON card_prices TO authenticated;
