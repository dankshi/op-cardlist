-- TCGplayer's API exposes rarity per product (e.g. "Secret Rare", "Special",
-- "Common"). Capturing it lets the auto-mapper disambiguate cases like
-- OP05-119 Luffy, which has 3 SEC variants and 3 SP variants — same
-- CardNumber, but the matching cards.rarity narrows the candidate set.
--
-- Backfill happens by re-running scripts/scrape-all-sets.ts; until then
-- this column is NULL for existing rows.

ALTER TABLE tcgplayer_products
  ADD COLUMN IF NOT EXISTS rarity TEXT;

CREATE INDEX IF NOT EXISTS idx_tcgplayer_products_rarity
  ON tcgplayer_products (rarity)
  WHERE rarity IS NOT NULL;
