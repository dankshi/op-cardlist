-- Population (census) counts per card per grading company per grade.
-- Sourced from each company's public-ish APIs/sites. Refreshed weekly.
-- Today we only fill PSA. BGS / TAG slots are left for future expansion.

CREATE TABLE IF NOT EXISTS card_grade_populations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  card_id TEXT NOT NULL,
  company TEXT NOT NULL,    -- 'PSA' | 'BGS' | 'CGC' | 'TAG'
  grade TEXT NOT NULL,      -- '10', '9.5', '9', ..., 'BL' for Black Label
  count INTEGER NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT card_grade_pop_company_valid
    CHECK (company IN ('PSA', 'BGS', 'CGC', 'TAG')),
  UNIQUE (card_id, company, grade)
);

CREATE INDEX IF NOT EXISTS idx_card_grade_pop_lookup
  ON card_grade_populations (card_id, company);

ALTER TABLE card_grade_populations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read populations"
  ON card_grade_populations FOR SELECT
  USING (true);

GRANT SELECT ON card_grade_populations TO anon;
GRANT SELECT ON card_grade_populations TO authenticated;

-- One-time per-card mapping from our card_id to PSA's spec ID, used to query
-- the PSA Public API's GetPSASpecPopulation endpoint. Filled in manually.
ALTER TABLE card_prices
  ADD COLUMN IF NOT EXISTS psa_spec_id BIGINT;
