-- The single source of truth for card_id ↔ tcgplayer_product_id.
--
-- Why a dedicated table instead of columns on card_prices?
--   - card_prices was conflating two concerns: *what product is this card?*
--     (changes rarely, set by human or auto-match) and *what's the latest
--     price?* (changes daily, set by scraper). Splitting means:
--       * The mapping has its own audit trail (manually_mapped, mapped_by,
--         source) without being entangled with daily price churn
--       * scrape-prices.ts only touches prices; it reads mappings from here
--       * Fixing a wrong mapping in one place takes effect everywhere
--
-- `source` distinguishes how the mapping was made:
--   'auto'   — set by scripts/auto-map-tcgplayer.ts using bandai card_number
--              + rarity + name marker matching against tcgplayer_products
--   'manual' — set by a human via /test page (overrides auto)
--   'review' — auto-match found a conflict with a prior mapping or was
--              ambiguous; needs human confirmation before being trusted
--
-- card_prices' mapping columns will be stripped in a follow-up migration
-- once this table is populated and all readers (scrape-prices, lib/cards,
-- /api/mappings) point here.

CREATE TABLE IF NOT EXISTS card_tcgplayer_mapping (
  card_id              TEXT PRIMARY KEY,
  tcgplayer_product_id INTEGER NOT NULL,
  tcgplayer_url        TEXT,
  tcgplayer_name       TEXT,
  source               TEXT NOT NULL DEFAULT 'auto'
                       CHECK (source IN ('auto', 'manual', 'review')),
  mapped_by            TEXT,                          -- email/username when source='manual'
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Reverse lookup: which card_ids share a tcgplayer_product_id? Useful for
-- the /test page's conflict detection and for the auto-mapper to avoid
-- double-assigning a product.
CREATE INDEX IF NOT EXISTS idx_card_tcgplayer_mapping_product
  ON card_tcgplayer_mapping (tcgplayer_product_id);

-- Quick filter for "needs review" admin page.
CREATE INDEX IF NOT EXISTS idx_card_tcgplayer_mapping_review
  ON card_tcgplayer_mapping (source) WHERE source = 'review';

ALTER TABLE card_tcgplayer_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read card_tcgplayer_mapping"
  ON card_tcgplayer_mapping FOR SELECT USING (true);

-- /test page submits mappings client-side via anon key; allow insert + update
-- (writes are still gated by the admin-only page UI).
CREATE POLICY "Anyone can insert card_tcgplayer_mapping"
  ON card_tcgplayer_mapping FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update card_tcgplayer_mapping"
  ON card_tcgplayer_mapping FOR UPDATE USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON card_tcgplayer_mapping TO anon, authenticated;
