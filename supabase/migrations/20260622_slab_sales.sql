-- Phase 1 of the slab-pricing pipeline (see docs/slab-pricing.md).
--
-- Generalize the eBay-only `card_graded_sales` table into a source-agnostic
-- `slab_sales` ledger that every graded-sale source (eBay, Alt-native auctions,
-- auction houses, manual admin entries) writes into, normalized to one shape.
--
-- Written idempotently: this migration was renumbered after a version collision
-- on the remote, so it must converge the schema to the same end-state whether or
-- not an earlier (differently-numbered) partial apply already created some of
-- these objects. The code that reads/writes the table deploys together with it.

-- 1. Ensure the table exists under the new name (rename only when needed).
DO $$
BEGIN
  IF to_regclass('public.card_graded_sales') IS NOT NULL
     AND to_regclass('public.slab_sales') IS NULL THEN
    ALTER TABLE card_graded_sales RENAME TO slab_sales;
  END IF;
END $$;

-- 2. New columns (idempotent).
ALTER TABLE slab_sales
  ADD COLUMN IF NOT EXISTS source           TEXT,                            -- ebay | alt | goldin | fanatics | whatnot | psa_apr | admin
  ADD COLUMN IF NOT EXISTS source_item_id   TEXT,                            -- generalizes ebay_item_id
  ADD COLUMN IF NOT EXISTS sale_kind        TEXT NOT NULL DEFAULT 'sold',    -- sold | auction | active_listing
  ADD COLUMN IF NOT EXISTS status           TEXT NOT NULL DEFAULT 'visible', -- visible | hidden | excluded
  ADD COLUMN IF NOT EXISTS excluded_reason  TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by      UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cert_number      TEXT,                            -- strongest cross-source dedup key
  ADD COLUMN IF NOT EXISTS parse_confidence TEXT;                            -- high | medium | low

-- Backfill existing eBay rows, then enforce NOT NULL on source (no default, so
-- future adapters must declare their source).
UPDATE slab_sales SET source = 'ebay' WHERE source IS NULL;
UPDATE slab_sales SET source_item_id = ebay_item_id WHERE source_item_id IS NULL AND ebay_item_id IS NOT NULL;
ALTER TABLE slab_sales ALTER COLUMN source SET NOT NULL;

-- 3. Constraints (guarded — CHECK constraints have no IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'slab_sales_status_valid') THEN
    ALTER TABLE slab_sales ADD CONSTRAINT slab_sales_status_valid CHECK (status IN ('visible', 'hidden', 'excluded'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'slab_sales_sale_kind_valid') THEN
    ALTER TABLE slab_sales ADD CONSTRAINT slab_sales_sale_kind_valid CHECK (sale_kind IN ('sold', 'auction', 'active_listing'));
  END IF;
END $$;

-- 4. Dedup + read indexes. (The pre-existing eBay indexes survive the rename.)
CREATE UNIQUE INDEX IF NOT EXISTS idx_slab_sales_cert
  ON slab_sales(cert_number) WHERE cert_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_slab_sales_source_item
  ON slab_sales(source, source_item_id) WHERE source_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_slab_sales_comp
  ON slab_sales(card_id, grading_company, grade, sold_at DESC) WHERE status = 'visible';

-- 5. Public reads limited to curated (visible) sales; admin tools read all via service role.
ALTER TABLE slab_sales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read graded sales" ON slab_sales;
DROP POLICY IF EXISTS "Public can read visible slab sales" ON slab_sales;
CREATE POLICY "Public can read visible slab sales"
  ON slab_sales FOR SELECT
  USING (status = 'visible');

COMMENT ON TABLE slab_sales IS
  'Graded card sales from all sources (source column). Service-role writes only; public reads are RLS-limited to status=visible. Curation (status/excluded_reason) lives on the row and survives re-scrapes because adapters upsert with ignoreDuplicates.';
