-- Individual sale transactions scraped from TCGPlayer's latestsales endpoint
-- Each row = one actual sale at an exact price

CREATE TABLE IF NOT EXISTS card_sales (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tcgplayer_product_id INTEGER NOT NULL,
  sold_at TIMESTAMPTZ NOT NULL,
  price NUMERIC NOT NULL,
  condition TEXT,
  quantity INTEGER DEFAULT 1,
  UNIQUE (tcgplayer_product_id, sold_at, price, condition)
);

-- Query sales for a specific product, ordered by date
CREATE INDEX IF NOT EXISTS idx_card_sales_product_date
  ON card_sales(tcgplayer_product_id, sold_at DESC);

-- Row Level Security
ALTER TABLE card_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read card sales"
  ON card_sales FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert card sales"
  ON card_sales FOR INSERT
  WITH CHECK (true);

-- Grants
GRANT SELECT, INSERT ON card_sales TO anon;
GRANT SELECT, INSERT, DELETE ON card_sales TO authenticated;
