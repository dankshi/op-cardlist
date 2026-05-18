-- The pops_psa_with_tcg view was created before the set_code column
-- existed on pops_psa, so it doesn't surface set_code to consumers.
-- Drop + recreate to include it. Same body as the previous version plus
-- p.set_code in the SELECT list.

DROP VIEW IF EXISTS pops_psa_with_tcg;

CREATE VIEW pops_psa_with_tcg AS
SELECT
  p.spec_id,
  p.psa_set_id,
  p.set_code,
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
