-- Phase 1 of the slab-pricing pipeline (see docs/slab-pricing.md).
--
-- The comp-engine output: one authoritative market value per
-- (card_id, grading_company, grade), recomputed nightly from slab_sales by
-- scripts/compute-slab-values.ts using a recency-weighted trimmed median.
--
-- This is the graded analog of the tcgplayer_current_prices view, but a real
-- table (not a view) because the value is a computed reduction over many sales,
-- not just "the latest row" — and because every card-page render reads it, we
-- want a single indexed lookup, not an aggregate-on-read.

CREATE TABLE IF NOT EXISTS slab_market_values (
  card_id          TEXT NOT NULL,
  grading_company  TEXT NOT NULL,
  grade            TEXT NOT NULL,
  market_value     NUMERIC,                 -- headline number (recency-weighted trimmed median); NULL only when confidence='none'
  last_sold_price  NUMERIC,
  last_sold_at     TIMESTAMPTZ,
  sample_size      INTEGER NOT NULL DEFAULT 0, -- visible solds in the window after trimming
  window_days      INTEGER NOT NULL,           -- 90, widened to 180/365 when thin
  dispersion       NUMERIC,                    -- coefficient of variation of the trimmed set
  confidence       TEXT NOT NULL,              -- high | medium | low | none
  trend_30d_pct    NUMERIC,                    -- (median last 30d / median prior 30d) - 1; NULL when insufficient history
  computed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (card_id, grading_company, grade),
  CONSTRAINT slab_market_values_company_valid
    CHECK (grading_company IN ('PSA', 'CGC', 'BGS', 'TAG')),
  CONSTRAINT slab_market_values_confidence_valid
    CHECK (confidence IN ('high', 'medium', 'low', 'none'))
);

-- Card pages fetch all variants for one card at once.
CREATE INDEX IF NOT EXISTS idx_slab_market_values_card ON slab_market_values(card_id);

ALTER TABLE slab_market_values ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read slab market values" ON slab_market_values;
CREATE POLICY "Anyone can read slab market values"
  ON slab_market_values FOR SELECT
  USING (true);

GRANT SELECT ON slab_market_values TO anon;
GRANT SELECT ON slab_market_values TO authenticated;

COMMENT ON TABLE slab_market_values IS
  'Computed market value per (card_id, grading_company, grade). Refreshed by scripts/compute-slab-values.ts from slab_sales. Read it for "the" graded price; readers prefer slab_value_overrides when an admin has pinned one.';
