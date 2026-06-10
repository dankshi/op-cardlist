-- Capture the eBay listing image (powers the admin verify UI: our card vs the
-- eBay photo, hover-to-expand) and the listing format. Best Offer "sold" prices
-- are the asking price (eBay hides the accepted offer), so the scraper flags
-- those parse_confidence='low' and stores listing_format='best_offer' for the
-- admin badge. See docs/slab-ingestion.md.

ALTER TABLE slab_sales
  ADD COLUMN IF NOT EXISTS image_url      TEXT,
  ADD COLUMN IF NOT EXISTS listing_format TEXT;  -- auction | buy_it_now | best_offer
