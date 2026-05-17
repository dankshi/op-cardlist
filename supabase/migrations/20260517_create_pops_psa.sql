-- PSA population data: one row per PSA SpecID we have ever seen.
--
-- This is the per-grading-company "spec catalog" pattern. PSA has its
-- own; future BGS / CGC / TAG support will create pops_bgs / pops_cgc /
-- pops_tag with the same shape, all grouped under the pops_* prefix.
--
-- card_id is the link to card_prices: NULL means the spec exists in
-- PSA's report but hasn't been matched to one of our bandai cards yet
-- (the manual-review worklist surfaced at /admin/psa-pops).
--
-- psa_card_number stores PSA's raw CardNumber separately. We never
-- synthesize a "{setCode}-{CardNumber}" prefix into description because
-- PSA reuses the CardNumber of a card's original printing for SP / TR
-- reprints (e.g. Ace's OP08 SP has CardNumber 013 but maps to
-- OP02-013_p3, not OP08-013). See docs/PSA-POP-MATCHING.md.
--
-- PSA half-grades (9.5, 8.5, etc.) are commercially noise for TCG
-- — only 10 / 9 / 8 / 7 are persisted.

CREATE TABLE IF NOT EXISTS pops_psa (
  spec_id          BIGINT PRIMARY KEY,                  -- PSA SpecID
  psa_set_id       BIGINT,                              -- PSA's heading ID for the set
  psa_card_number  TEXT,                                -- PSA's raw CardNumber, stored verbatim
  description      TEXT,                                -- "SubjectName (Variety)" — no synthesized prefix
  card_id          TEXT,                                -- our bandai ID; NULL = unmapped
  total_pop        INTEGER,                             -- PSAPop.Total cached for triage
  grade_10         INTEGER,
  grade_9          INTEGER,
  grade_8          INTEGER,
  grade_7          INTEGER,
  first_seen       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (card_id)                                       -- at most one spec per card; multiple NULLs OK
);

CREATE INDEX IF NOT EXISTS idx_pops_psa_set      ON pops_psa (psa_set_id);
CREATE INDEX IF NOT EXISTS idx_pops_psa_unmapped ON pops_psa (psa_set_id) WHERE card_id IS NULL;

ALTER TABLE pops_psa ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read pops_psa"
  ON pops_psa FOR SELECT USING (true);

GRANT SELECT ON pops_psa TO anon;
GRANT SELECT ON pops_psa TO authenticated;

-- View used by /admin/psa-pops to detect "stale" mappings — pops_psa
-- rows where the PSA variety in the description no longer agrees with
-- the linked card_prices row's TCGplayer name. Recomputed live on every
-- page load; no caching.
CREATE OR REPLACE VIEW pops_psa_with_tcg AS
SELECT
  p.spec_id,
  p.psa_set_id,
  p.psa_card_number,
  p.description,
  p.card_id,
  p.total_pop,
  p.synced_at,
  c.tcgplayer_product_name AS tcg_name,
  c.tcgplayer_url          AS tcg_url
FROM pops_psa p
LEFT JOIN card_prices c ON c.card_id = p.card_id;

GRANT SELECT ON pops_psa_with_tcg TO anon;
GRANT SELECT ON pops_psa_with_tcg TO authenticated;
