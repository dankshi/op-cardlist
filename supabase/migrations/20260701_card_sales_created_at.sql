-- Track when WE ingested each sale, so the HQ can show a true "new sales / 24h"
-- intake rate. card_sales.sold_at is when the sale happened on TCGplayer, not
-- when our scraper first stored it.
--
-- Existing rows are intentionally left NULL (not backfilled to now()), so they
-- don't all count as "ingested in the last 24h" right after this migration.
-- The default applies to future inserts only.

ALTER TABLE card_sales ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
ALTER TABLE card_sales ALTER COLUMN created_at SET DEFAULT now();

-- Powers the cheap `count(*) where created_at > now()-24h` in the HQ status API.
CREATE INDEX IF NOT EXISTS idx_card_sales_created_at ON card_sales(created_at);

COMMENT ON COLUMN card_sales.created_at IS
  'When our scraper first inserted this sale (NULL for rows that predate this column). Distinct from sold_at (the marketplace sale time). Used for ingestion-rate metrics.';
