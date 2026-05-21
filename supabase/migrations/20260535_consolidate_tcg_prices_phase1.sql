-- Consolidate the TCGplayer price tables — phase 1 (additive).
--
-- Today's setup:
--   tcgplayer_products             keyed by product_id, holds current prices
--   tcgplayer_card_prices          keyed by card_id, ALSO holds current prices
--                                  (denormalized, gets stale when mapping changes)
--   tcgplayer_card_price_history   keyed by (product_id, date), source of truth
--   card_tcgplayer_mapping         keyed by card_id, links card → product
--
-- Problem: tcgplayer_card_prices is keyed by card_id but holds product-level
-- prices. When card_tcgplayer_mapping is corrected (e.g. a card was wrongly
-- mapped to the base print and later moved to the SP variant), the price row
-- keeps the OLD product's price until the next scrape — causing visible
-- $9 prices on cards that should show $200+ (e.g. EB03-031_p2).
--
-- End state: prices live in ONE place — tcgplayer_card_price_history. The
-- "current price" is just the latest row per product. A view exposes that
-- cleanly. tcgplayer_card_prices goes away in phase 2 (next migration).
--
-- This migration is additive only — nothing breaks if it ships before the
-- code switchover.

-- 1. Move the eBay sales fields (last_sold_price, last_sold_date,
--    sales_scraped_at) onto tcgplayer_products so they live next to the
--    catalog metadata — they're single-value, not time-series. Backfilled
--    from tcgplayer_card_prices via card_tcgplayer_mapping.
ALTER TABLE tcgplayer_products
  ADD COLUMN IF NOT EXISTS last_sold_price NUMERIC,
  ADD COLUMN IF NOT EXISTS last_sold_date  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sales_scraped_at TIMESTAMPTZ;

-- Backfill: for each card that has a mapping, copy its tcgplayer_card_prices
-- sales fields to the mapped product. There are 90+ rows where the mapping
-- has been corrected and the price row is stale on market fields — but
-- last_sold_* is product-level data that's still consistent with whichever
-- product the card currently points at.
UPDATE tcgplayer_products tp
SET
  last_sold_price  = cp.last_sold_price,
  last_sold_date   = cp.last_sold_date,
  sales_scraped_at = cp.sales_scraped_at
FROM card_tcgplayer_mapping m
JOIN tcgplayer_card_prices cp ON cp.card_id = m.card_id
WHERE tp.product_id = m.tcgplayer_product_id
  AND (cp.last_sold_price IS NOT NULL OR cp.last_sold_date IS NOT NULL);

-- 2. Convenience view: latest history row per product. Reads JOIN this via
--    card_tcgplayer_mapping to get "what does this card cost right now".
--    DISTINCT ON is O(log n) per product with the PK index on
--    (tcgplayer_product_id, recorded_date) — fast for the 6k-product scale.
CREATE OR REPLACE VIEW tcgplayer_current_prices AS
SELECT DISTINCT ON (tcgplayer_product_id)
  tcgplayer_product_id,
  recorded_date,
  market_price,
  lowest_price,
  median_price,
  total_listings
FROM tcgplayer_card_price_history
ORDER BY tcgplayer_product_id, recorded_date DESC;

GRANT SELECT ON tcgplayer_current_prices TO anon, authenticated;
