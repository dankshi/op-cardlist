-- Consolidate TCGplayer prices — phase 1.5 (backfill history).
--
-- tcgplayer_card_price_history is the new source of truth for prices, but
-- it's sparse: many products in tcgplayer_products have no history row at
-- all (the price-scraper has been missing some products, especially the
-- ones where mapping was wrong). Without this backfill, the
-- tcgplayer_current_prices view returns NULL for them — which would make
-- the upcoming fetchPrices() switchover regress prices on the public site.
--
-- Fix: insert one history row per product, dated today, using the current
-- prices on tcgplayer_products. Idempotent via ON CONFLICT — if scrape-prices
-- already wrote today's row for a product, the existing row wins (don't
-- overwrite real scrape data with the products-table snapshot).
--
-- Once this lands, the price columns on tcgplayer_products can be dropped
-- safely (next migration). The current view returns useful data immediately.

INSERT INTO tcgplayer_card_price_history (
  tcgplayer_product_id,
  recorded_date,
  market_price,
  lowest_price,
  median_price,
  total_listings
)
SELECT
  product_id,
  CURRENT_DATE,
  market_price,
  lowest_price,
  median_price,
  total_listings
FROM tcgplayer_products
WHERE market_price IS NOT NULL
   OR lowest_price IS NOT NULL
   OR median_price IS NOT NULL
ON CONFLICT (tcgplayer_product_id, recorded_date) DO NOTHING;
