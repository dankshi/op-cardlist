-- All TCGPlayer products discovered across all One Piece sets
-- Populated by scripts/scrape-all-sets.ts

CREATE TABLE IF NOT EXISTS tcgplayer_products (
  product_id INTEGER PRIMARY KEY,
  product_name TEXT NOT NULL,
  set_name TEXT NOT NULL REFERENCES tcgplayer_sets(set_name),
  card_number TEXT,                        -- From customAttributes.number e.g. "OP13-001"
  product_url_name TEXT,                   -- URL slug for product page
  market_price NUMERIC,
  lowest_price NUMERIC,
  median_price NUMERIC,
  total_listings INTEGER,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_tcgplayer_products_set ON tcgplayer_products(set_name);
CREATE INDEX IF NOT EXISTS idx_tcgplayer_products_card_number ON tcgplayer_products(card_number);

-- Auto-update updated_at on changes
DROP TRIGGER IF EXISTS update_tcgplayer_products_updated_at ON tcgplayer_products;
CREATE TRIGGER update_tcgplayer_products_updated_at
  BEFORE UPDATE ON tcgplayer_products
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security
ALTER TABLE tcgplayer_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read tcgplayer_products"
  ON tcgplayer_products FOR SELECT USING (true);
CREATE POLICY "Anyone can insert tcgplayer_products"
  ON tcgplayer_products FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update tcgplayer_products"
  ON tcgplayer_products FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can delete tcgplayer_products"
  ON tcgplayer_products FOR DELETE USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON tcgplayer_products TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON tcgplayer_products TO authenticated;
