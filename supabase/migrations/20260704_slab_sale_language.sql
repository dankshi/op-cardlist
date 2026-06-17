-- Tag each graded sale's print language so English and Japanese versions of the
-- same card number (different markets/prices) can be separated. Detected from
-- the eBay title ("Japanese"/"JP"/"日本" → japanese, else english). We scrape and
-- keep both — the comp can filter by language per card. See docs/slab-ingestion.md.

ALTER TABLE slab_sales
  ADD COLUMN IF NOT EXISTS language TEXT; -- 'english' | 'japanese'
