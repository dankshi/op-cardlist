-- Phase 1 of the slab-pricing pipeline (see docs/slab-pricing.md).
--
-- Manual authority over the comp engine. When an admin pins a value here, readers
-- prefer it over the computed slab_market_values.market_value. Same philosophy as
-- card_tcgplayer_mapping.source='manual': a human can always overrule the machine,
-- and the override sticks across recomputes.
--
-- Use for ultra-thin variants (a BGS Black Label 10 that sells once a year) or a
-- known-bad computed value pending a data fix.

CREATE TABLE IF NOT EXISTS slab_value_overrides (
  card_id          TEXT NOT NULL,
  grading_company  TEXT NOT NULL,
  grade            TEXT NOT NULL,
  value            NUMERIC NOT NULL,
  note             TEXT,
  set_by           UUID REFERENCES auth.users(id),
  set_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (card_id, grading_company, grade),
  CONSTRAINT slab_value_overrides_company_valid
    CHECK (grading_company IN ('PSA', 'CGC', 'BGS', 'TAG'))
);

ALTER TABLE slab_value_overrides ENABLE ROW LEVEL SECURITY;

-- Public reads so the override can be applied on the card page; writes are
-- service-role only (the admin API uses the service-role client, same as
-- /api/admin/* elsewhere).
DROP POLICY IF EXISTS "Anyone can read slab value overrides" ON slab_value_overrides;
CREATE POLICY "Anyone can read slab value overrides"
  ON slab_value_overrides FOR SELECT
  USING (true);

GRANT SELECT ON slab_value_overrides TO anon;
GRANT SELECT ON slab_value_overrides TO authenticated;

COMMENT ON TABLE slab_value_overrides IS
  'Admin-pinned market value per (card_id, grading_company, grade). Overrides slab_market_values on read. Service-role writes only.';
