-- Graded card sales scraped from eBay sold listings.
-- Separate from card_sales (which is TCGPlayer's ungraded sales) because:
--   1. Title parsing extracts company + grade, so the dimensions differ.
--   2. eBay is a noisier source — we want to keep the raw title for audit.

CREATE TABLE IF NOT EXISTS card_graded_sales (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  card_id TEXT NOT NULL,            -- our internal card_id (e.g. "OP07-051")
  grading_company TEXT NOT NULL,    -- 'PSA' | 'CGC' | 'BGS' | 'TAG'
  grade TEXT NOT NULL,              -- '10', '9.5', '9', etc. — kept as TEXT for half-grades
  sold_at TIMESTAMPTZ NOT NULL,
  price NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  title TEXT NOT NULL,              -- raw eBay listing title (for debugging parse errors)
  ebay_item_id TEXT,                -- eBay listing id when extractable; used to dedupe
  listing_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT card_graded_sales_company_valid
    CHECK (grading_company IN ('PSA', 'CGC', 'BGS', 'TAG'))
);

-- Most lookups are: "give me the recent PSA 10 sales for this card".
CREATE INDEX IF NOT EXISTS idx_graded_sales_lookup
  ON card_graded_sales(card_id, grading_company, grade, sold_at DESC);

-- Dedupe on eBay item id when present; for older listings without one, the title+sold_at+price tuple is a good-enough hash.
CREATE UNIQUE INDEX IF NOT EXISTS idx_graded_sales_ebay_item
  ON card_graded_sales(ebay_item_id) WHERE ebay_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_graded_sales_natural_key
  ON card_graded_sales(card_id, title, sold_at, price) WHERE ebay_item_id IS NULL;

ALTER TABLE card_graded_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read graded sales"
  ON card_graded_sales FOR SELECT
  USING (true);

GRANT SELECT ON card_graded_sales TO anon;
GRANT SELECT ON card_graded_sales TO authenticated;

COMMENT ON TABLE card_graded_sales IS
  'Graded card sales from eBay sold listings. Inserts happen via service-role scraper only.';
