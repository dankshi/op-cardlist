-- Daily price snapshots for historical tracking
-- Keyed by tcgplayer_product_id (not card_id) so remapping cards doesn't corrupt history
-- Populated by scrape-prices.ts (forward) and backfill-price-history.ts (historical via TCGCSV)

CREATE TABLE IF NOT EXISTS card_price_history (
  tcgplayer_product_id INTEGER NOT NULL,
  recorded_date DATE NOT NULL,
  market_price NUMERIC,
  lowest_price NUMERIC,
  median_price NUMERIC,
  total_listings INTEGER,
  PRIMARY KEY (tcgplayer_product_id, recorded_date)
);

-- Index for querying all products on a given date (useful for backfill verification)
CREATE INDEX IF NOT EXISTS idx_card_price_history_date
  ON card_price_history(recorded_date);

-- Row Level Security
ALTER TABLE card_price_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read card price history"
  ON card_price_history FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert card price history"
  ON card_price_history FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update card price history"
  ON card_price_history FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Grants
GRANT SELECT, INSERT, UPDATE ON card_price_history TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON card_price_history TO authenticated;
