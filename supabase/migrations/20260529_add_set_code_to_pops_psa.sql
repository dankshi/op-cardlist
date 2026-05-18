-- Add a human-readable set_code column to pops_psa so admins can see at a
-- glance which set a PSA spec belongs to (op-08, prb-02, etc.) without
-- having to remember the opaque psa_set_id numbers (224322, 318867, …).
-- Also lets us narrow candidate cards during auto-matching by the set
-- code directly instead of going through PSA_SETS lookup every time.
--
-- The mapping (psa_set_id → set_code) mirrors PSA_SETS in
-- scripts/psa-pop-fetch.ts. If that array changes, this backfill needs to
-- be re-run for any specs whose set_code became stale.

ALTER TABLE pops_psa ADD COLUMN IF NOT EXISTS set_code TEXT;

UPDATE pops_psa SET set_code = CASE psa_set_id
  WHEN 224322 THEN 'op-01'
  WHEN 233905 THEN 'op-02'
  WHEN 242625 THEN 'op-03'
  WHEN 249021 THEN 'op-04'
  WHEN 256095 THEN 'op-05'
  WHEN 263953 THEN 'op-06'
  WHEN 274048 THEN 'op-07'
  WHEN 280554 THEN 'op-08'
  WHEN 288478 THEN 'op-09'
  WHEN 298200 THEN 'op-10'
  WHEN 304942 THEN 'op-11'
  WHEN 314057 THEN 'op-12'
  WHEN 321523 THEN 'op-13'
  WHEN 327430 THEN 'op14-eb04'
  WHEN 335640 THEN 'op15-eb04'
  WHEN 269483 THEN 'eb-01'
  WHEN 302771 THEN 'eb-02'
  WHEN 331864 THEN 'eb-03'
  WHEN 284770 THEN 'prb-01'
  WHEN 318867 THEN 'prb-02'
  ELSE NULL
END
WHERE set_code IS NULL;

CREATE INDEX IF NOT EXISTS idx_pops_psa_set_code ON pops_psa(set_code);
