-- Consolidate TCGplayer prices — phase 2 (drops).
--
-- Phase 1 (migrations 20260535/20260536) added the new structure:
--   - last_sold_* moved onto tcgplayer_products
--   - tcgplayer_current_prices view exposes "latest history row per product"
--   - tcgplayer_card_price_history was backfilled with one row per product
--     dated CURRENT_DATE so the view returns useful data immediately
--
-- All readers (src/lib/cards.ts, src/lib/price-history.ts, /api/prices,
-- /api/mappings) and writers (scrape-prices.ts, scrape-all-sets.ts) have
-- been switched to the new sources. Nothing should be touching the old
-- denormalized columns. Time to drop them.
--
-- The card_id-keyed price table goes entirely. The market/lowest/median/
-- total_listings columns come off tcgplayer_products. card_sales,
-- tcgplayer_card_price_history, card_tcgplayer_mapping, tcgplayer_products
-- (catalog + last_sold_*) are now the only price-related tables.

DROP TABLE IF EXISTS tcgplayer_card_prices;

ALTER TABLE tcgplayer_products
  DROP COLUMN IF EXISTS market_price,
  DROP COLUMN IF EXISTS lowest_price,
  DROP COLUMN IF EXISTS median_price,
  DROP COLUMN IF EXISTS total_listings;
