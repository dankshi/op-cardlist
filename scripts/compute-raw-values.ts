// Compute our raw-card market values: reduce the card_sales ledger into one
// Near-Mint value per product and upsert into raw_market_values. The raw analog
// of compute-slab-values.ts. See docs/raw-pricing.md.
//
// The algorithm (recency-weighted trimmed median) lives in src/lib/slab-comp.ts
// and the DB orchestration in src/lib/raw-comp-recompute.ts — shared with the
// sales scraper's incremental recompute so batch + incremental always agree.
//
// Usage:
//   npx tsx scripts/compute-raw-values.ts            # all products (backfill)
//   npx tsx scripts/compute-raw-values.ts --dry-run  # compute + print, no write

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { computeVariantValue, MAX_LOOKBACK_DAYS, type Sale } from '../src/lib/slab-comp'
import { recomputeRawValues, RAW_CONDITION } from '../src/lib/raw-comp-recompute'

dotenv.config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  const dryRun = process.argv.slice(2).includes('--dry-run')

  if (!dryRun) {
    const written = await recomputeRawValues(supabase)
    console.log(`Done. Upserted ${written} product value(s) (${RAW_CONDITION}).`)
    return
  }

  // Dry run: read + compute + print, write nothing. Mirrors the helper's query.
  const since = new Date()
  since.setDate(since.getDate() - MAX_LOOKBACK_DAYS)
  const rows: { tcgplayer_product_id: number; price: number | string; sold_at: string }[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('card_sales')
      .select('tcgplayer_product_id, price, sold_at')
      .eq('condition', RAW_CONDITION)
      .gte('sold_at', since.toISOString())
      .range(from, from + PAGE - 1)
    if (error) { console.error('Query failed:', error.message); process.exit(1) }
    if (!data || data.length === 0) break
    rows.push(...(data as typeof rows))
    if (data.length < PAGE) break
  }
  console.log(`Loaded ${rows.length} ${RAW_CONDITION} sales (last ${MAX_LOOKBACK_DAYS}d).`)

  const groups = new Map<number, Sale[]>()
  for (const r of rows) {
    const price = Number(r.price)
    if (!Number.isFinite(price) || price <= 0) continue
    const list = groups.get(r.tcgplayer_product_id) ?? []
    list.push({ price, soldAt: new Date(r.sold_at) })
    groups.set(r.tcgplayer_product_id, list)
  }

  const now = new Date()
  for (const [pid, sales] of groups) {
    const c = computeVariantValue(sales, now)
    console.log(
      `  product ${pid}: ${c.market_value == null ? '—' : '$' + c.market_value.toFixed(2)} ` +
        `(${c.confidence}, n=${c.sample_size}/${c.window_days}d)`,
    )
  }
  console.log(`Computed ${groups.size} product value(s). Dry run — nothing written.`)
}

main().catch(err => { console.error(err); process.exit(1) })
