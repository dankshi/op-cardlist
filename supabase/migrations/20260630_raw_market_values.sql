-- Our own raw-card market value, computed from actual TCGplayer sales.
--
-- The raw analog of slab_market_values: instead of trusting TCGplayer's opaque
-- `marketPrice`, we reduce the card_sales ledger (real sold prices) into one
-- value per (product, condition) using the SAME recency-weighted trimmed-median
-- model as slabs (src/lib/slab-comp.ts). For now we only value 'Near Mint' —
-- the condition TCGplayer's headline market price reflects — so the two are
-- directly comparable. Product-keyed (like tcgplayer_current_prices) and read
-- on card-page renders, so it's a table with a single indexed lookup, not an
-- aggregate-on-read.
--
-- Refreshed by scripts/compute-raw-values.ts (full backfill) and incrementally
-- by the sales scraper after each rotation window (src/lib/raw-comp-recompute).

CREATE TABLE IF NOT EXISTS raw_market_values (
  tcgplayer_product_id INTEGER NOT NULL,
  condition            TEXT NOT NULL,              -- 'Near Mint' for now
  market_value         NUMERIC,                    -- recency-weighted trimmed median; NULL when confidence='none'
  last_sold_price      NUMERIC,
  last_sold_at         TIMESTAMPTZ,
  sample_size          INTEGER NOT NULL DEFAULT 0, -- sales in the window after trimming
  window_days          INTEGER,                    -- 90, widened to 180/365 when thin
  dispersion           NUMERIC,                    -- coefficient of variation of the trimmed set
  confidence           TEXT NOT NULL DEFAULT 'none', -- high | medium | low | none
  trend_30d_pct        NUMERIC,                    -- (median last 30d / median prior 30d) - 1
  computed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (tcgplayer_product_id, condition),
  CONSTRAINT raw_market_values_confidence_valid
    CHECK (confidence IN ('high', 'medium', 'low', 'none'))
);

CREATE INDEX IF NOT EXISTS idx_raw_market_values_product ON raw_market_values(tcgplayer_product_id);

ALTER TABLE raw_market_values ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read raw market values" ON raw_market_values;
CREATE POLICY "Anyone can read raw market values"
  ON raw_market_values FOR SELECT
  USING (true);

GRANT SELECT ON raw_market_values TO anon;
GRANT SELECT ON raw_market_values TO authenticated;

COMMENT ON TABLE raw_market_values IS
  'Our computed raw-card market value per (tcgplayer_product_id, condition), from card_sales via the slab recency-weighted trimmed-median model. Shown alongside TCGplayer market price; not yet the headline.';
