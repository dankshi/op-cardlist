-- Add a dedicated variety column to pops_psa instead of parsing it back
-- out of description with a regex each time. Stores PSA's Variety field
-- verbatim: 'Alternate Art', 'Manga Alternate Art', 'Special Alternate Art',
-- 'Treasure Rare', 'Wanted Alternate Art', 'Pre-Release', or '' (base).
--
-- Backfill from the description, which currently looks like:
--   '${SubjectName} (${Variety})' for variant cards
--   '${SubjectName}'              for base cards
-- So we regex-extract the last parenthesized group.

ALTER TABLE pops_psa ADD COLUMN IF NOT EXISTS variety TEXT;

UPDATE pops_psa
SET variety = COALESCE(
  (regexp_match(description, '\(([^()]+)\)\s*$'))[1],
  ''
)
WHERE variety IS NULL;

CREATE INDEX IF NOT EXISTS idx_pops_psa_variety ON pops_psa(variety);

-- Update the helper view so admin pages can read variety directly.
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
  p.total_pop,
  p.synced_at,
  m.tcgplayer_name AS tcg_name,
  m.tcgplayer_url  AS tcg_url
FROM pops_psa p
LEFT JOIN card_tcgplayer_mapping m ON m.card_id = p.card_id;

GRANT SELECT ON pops_psa_with_tcg TO anon;
GRANT SELECT ON pops_psa_with_tcg TO authenticated;
