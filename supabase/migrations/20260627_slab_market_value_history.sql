-- Daily snapshot of slab_market_values so the portfolio chart can value graded
-- holdings *over time* — the graded analog of tcgplayer_card_price_history.
-- slab_market_values is a current snapshot; this accumulates one row per variant
-- per day, appended by recomputeSlabCards (src/lib/slab-comp-recompute.ts) on
-- each compute run. See docs/slab-pricing.md.

CREATE TABLE IF NOT EXISTS slab_market_value_history (
  card_id          TEXT NOT NULL,
  grading_company  TEXT NOT NULL,
  grade            TEXT NOT NULL,
  recorded_date    DATE NOT NULL,
  market_value     NUMERIC,            -- comp value on that date; NULL when confidence='none'
  PRIMARY KEY (card_id, grading_company, grade, recorded_date)
);

CREATE INDEX IF NOT EXISTS idx_slab_mv_history_card ON slab_market_value_history(card_id);

ALTER TABLE slab_market_value_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read slab value history" ON slab_market_value_history;
CREATE POLICY "Anyone can read slab value history"
  ON slab_market_value_history FOR SELECT
  USING (true);
GRANT SELECT ON slab_market_value_history TO anon;
GRANT SELECT ON slab_market_value_history TO authenticated;

COMMENT ON TABLE slab_market_value_history IS
  'Daily snapshots of slab_market_values for portfolio time-series. Appended by recomputeSlabCards.';
