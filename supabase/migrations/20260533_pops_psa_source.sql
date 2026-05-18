-- Track whether a pops_psa.card_id link was set by the auto-matcher or
-- by a human via the admin UI. Mirrors the source/mapped_by/mapped_at
-- pattern already on card_tcgplayer_mapping.
--
-- The auto-matcher (`psa-pop-fetch.ts --match-only`) will preserve
-- source='manual' rows during re-derivation so admin fixes don't get
-- overwritten on the next run.

ALTER TABLE pops_psa
  ADD COLUMN IF NOT EXISTS source     TEXT NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS mapped_by  TEXT,
  ADD COLUMN IF NOT EXISTS mapped_at  TIMESTAMPTZ;

-- All existing rows came from the matcher, so 'auto' is right (which is
-- already the default). No backfill needed.

-- Expose the new columns through the helper view.
DROP VIEW IF EXISTS pops_psa_with_tcg;

CREATE VIEW pops_psa_with_tcg AS
SELECT
  p.spec_id,
  p.psa_set_id,
  p.set_code,
  p.psa_card_number,
  p.description,
  p.variety,
  p.card_id,
  p.source,
  p.mapped_by,
  p.mapped_at,
  p.total_pop,
  p.synced_at,
  m.tcgplayer_name AS tcg_name,
  m.tcgplayer_url  AS tcg_url
FROM pops_psa p
LEFT JOIN card_tcgplayer_mapping m ON m.card_id = p.card_id;

GRANT SELECT ON pops_psa_with_tcg TO anon;
GRANT SELECT ON pops_psa_with_tcg TO authenticated;
