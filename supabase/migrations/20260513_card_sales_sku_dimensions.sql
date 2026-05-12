-- Enrich card_sales with the per-listing dimensions TCGPlayer's authenticated
-- latestsales feed returns: variant (Foil/Normal), language (English/Japanese/
-- etc.), listing_type (ListingWithoutPhotos vs ListingWithPhotos), shipping_price,
-- and a custom_listing_id for seller-custom-titled listings that we filter out
-- of stats.

ALTER TABLE card_sales ADD COLUMN IF NOT EXISTS variant TEXT;
ALTER TABLE card_sales ADD COLUMN IF NOT EXISTS language TEXT;
ALTER TABLE card_sales ADD COLUMN IF NOT EXISTS listing_type TEXT;
ALTER TABLE card_sales ADD COLUMN IF NOT EXISTS shipping_price NUMERIC;
ALTER TABLE card_sales ADD COLUMN IF NOT EXISTS custom_listing_id TEXT;

-- Old constraint UNIQUE(tcgplayer_product_id, sold_at, price, condition) would
-- merge English NM Foil and Japanese NM Foil sales that happen at the same
-- timestamp/price. Include variant + language so they stay distinct.
ALTER TABLE card_sales
  DROP CONSTRAINT IF EXISTS card_sales_tcgplayer_product_id_sold_at_price_condition_key;

-- The new unique key allows NULLs (existing pre-2026-05 rows have NULL variant/
-- language). Postgres treats NULLs as distinct in UNIQUE, so old rows won't
-- collide with new rows, and re-scraping won't create dupes since the new
-- scraper always supplies non-NULL values.
ALTER TABLE card_sales
  ADD CONSTRAINT card_sales_uq UNIQUE (
    tcgplayer_product_id, sold_at, price, condition, variant, language
  );
