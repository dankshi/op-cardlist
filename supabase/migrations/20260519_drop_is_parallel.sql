-- Drop cards.is_parallel.
--
-- The column was redundant: the scraper set it iff `variant IS NOT NULL`
-- (the suffix after '_' on the Bandai card ID). Readers now compute it
-- on the fly via `variant != null` in rowToCard (src/lib/cards.ts),
-- so the stored column has no remaining purpose.
--
-- Pre-checks before running this migration:
--   1. All app code that read `is_parallel` was updated in the same
--      change set — Card.isParallel is derived from variant.
--   2. The scrape-bandai-cards.ts CardRow no longer includes the field,
--      so future scrapes won't try to write to a missing column.
--   3. No RLS policies, views, or indexes reference is_parallel
--      (verified via grep across supabase/migrations).

ALTER TABLE cards DROP COLUMN IF EXISTS is_parallel;
