-- Strip the deprecated mapping columns from tcgplayer_card_prices.
--
-- Background: tcgplayer_card_prices used to hold both prices AND the
-- card_id ↔ tcgplayer_product_id mapping. The mapping has now moved to
-- card_tcgplayer_mapping (single source of truth, populated by
-- scripts/auto-map-tcgplayer.ts and the /test page). After the
-- corresponding code changes in scrape-prices.ts, /api/mappings, and
-- lib/cards.ts, nothing writes or reads these columns anymore.
--
-- After this, tcgplayer_card_prices is purely a price snapshot table:
--   card_id (PK)
--   market_price, lowest_price, median_price, total_listings
--   last_sold_price, last_sold_date
--   sales_scraped_at (rotation tracking)
--   updated_at
--
-- The index on manually_mapped goes too since it referenced the dropped
-- column.

DROP INDEX IF EXISTS idx_card_prices_manually_mapped;

-- pops_psa_with_tcg view depends on tcgplayer_card_prices.tcgplayer_*
-- columns. Drop + recreate it pointing at card_tcgplayer_mapping instead
-- (which is now the source of truth for the TCG link).
DROP VIEW IF EXISTS pops_psa_with_tcg;

ALTER TABLE tcgplayer_card_prices
  DROP COLUMN IF EXISTS tcgplayer_product_id,
  DROP COLUMN IF EXISTS tcgplayer_product_name,
  DROP COLUMN IF EXISTS tcgplayer_url,
  DROP COLUMN IF EXISTS manually_mapped,
  DROP COLUMN IF EXISTS mapped_by;

CREATE VIEW pops_psa_with_tcg AS
SELECT
  p.spec_id,
  p.psa_set_id,
  p.psa_card_number,
  p.description,
  p.card_id,
  p.total_pop,
  p.synced_at,
  m.tcgplayer_name AS tcg_name,
  m.tcgplayer_url  AS tcg_url
FROM pops_psa p
LEFT JOIN card_tcgplayer_mapping m ON m.card_id = p.card_id;

GRANT SELECT ON pops_psa_with_tcg TO anon;
GRANT SELECT ON pops_psa_with_tcg TO authenticated;
