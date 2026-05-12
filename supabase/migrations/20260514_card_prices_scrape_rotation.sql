-- Track when we last fetched per-line sales for each product so the scraper
-- can rotate — touching the staleness-oldest N products per run rather than
-- hammering every product daily. Keeps our request volume natural-looking and
-- avoids tripping TCGPlayer's anti-bot.

ALTER TABLE card_prices
  ADD COLUMN IF NOT EXISTS sales_scraped_at TIMESTAMPTZ;

-- Sort target: oldest (or never-scraped) cards first.
CREATE INDEX IF NOT EXISTS idx_card_prices_sales_scraped_at
  ON card_prices (sales_scraped_at NULLS FIRST);

COMMENT ON COLUMN card_prices.sales_scraped_at IS
  'Timestamp of the most recent attempt to fetch per-line sales (card_sales)
   for this product. Updated regardless of whether sales were actually
   returned. The scrape-prices script orders by this NULLS FIRST and processes
   only the N stalest products per run to keep traffic patterns natural.';
