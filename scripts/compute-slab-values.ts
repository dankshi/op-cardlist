// Compute the comp engine: reduce the noisy slab_sales ledger into one
// authoritative market value per (card_id, grading_company, grade) and upsert
// into slab_market_values. See docs/slab-pricing.md.
//
// The algorithm (recency-weighted trimmed median) lives in src/lib/slab-comp.ts
// and the DB orchestration in src/lib/slab-comp-recompute.ts — both shared with
// the admin instant-recompute path so curation edits and this nightly batch
// always agree. This script is just the CLI wrapper.
//
// Run as the final step of the slab-scrape pipeline. Idempotent.
//
// Usage:
//   npx tsx scripts/compute-slab-values.ts            # all variants
//   npx tsx scripts/compute-slab-values.ts OP07-051   # one card
//   npx tsx scripts/compute-slab-values.ts --dry-run  # compute + print, don't write

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { computeCardValues, MAX_LOOKBACK_DAYS, type CardGradeSales } from '../src/lib/slab-comp'
import { recomputeSlabCards } from '../src/lib/slab-comp-recompute'

dotenv.config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const cardId = args.find(a => !a.startsWith('--')) ?? null
  const cardIds = cardId ? [cardId] : undefined

  if (!dryRun) {
    const written = await recomputeSlabCards(supabase, { cardIds })
    console.log(`Done. Upserted ${written} variant value(s)${cardId ? ` for ${cardId}` : ''}.`)
    return
  }

  // Dry run: read + compute + print, write nothing. Mirrors the helper's query.
  const since = new Date()
  since.setDate(since.getDate() - MAX_LOOKBACK_DAYS)
  let query = supabase
    .from('slab_sales')
    .select('card_id, grading_company, grade, price, sold_at, listing_format')
    .eq('status', 'visible')
    .eq('sale_kind', 'sold')
    .gte('sold_at', since.toISOString())
  if (cardId) query = query.eq('card_id', cardId)
  const { data: rows, error } = await query
  if (error) {
    console.error('Query failed:', error.message)
    process.exit(1)
  }
  console.log(`Loaded ${rows?.length ?? 0} visible sold sales (last ${MAX_LOOKBACK_DAYS}d${cardId ? `, card ${cardId}` : ''}).`)

  const cards = new Map<string, { cardId: string; grades: Map<string, CardGradeSales> }>()
  for (const r of rows ?? []) {
    const price = Number(r.price)
    if (!Number.isFinite(price) || price <= 0) continue
    if (r.listing_format === 'best_offer') continue // "Best offer accepted" = struck ask, not a real price
    const cardId = r.card_id as string
    let bucket = cards.get(cardId)
    if (!bucket) { bucket = { cardId, grades: new Map() }; cards.set(cardId, bucket) }
    const gk = `${r.grading_company}|${r.grade}`
    let g = bucket.grades.get(gk)
    if (!g) { g = { company: r.grading_company as string, grade: r.grade as string, sales: [] }; bucket.grades.set(gk, g) }
    g.sales.push({ price, soldAt: new Date(r.sold_at as string) })
  }

  const now = new Date()
  let count = 0
  for (const bucket of cards.values()) {
    for (const { company, grade, value: c } of computeCardValues([...bucket.grades.values()], now)) {
      count++
      console.log(
        `  ${bucket.cardId} ${company} ${grade}: ` +
          `${c.market_value == null ? '—' : '$' + c.market_value.toFixed(2)} ` +
          `(${c.confidence}, n=${c.sample_size}/${c.window_days}d` +
          `${c.trend_30d_pct == null ? '' : `, trend ${(c.trend_30d_pct * 100).toFixed(0)}%`})`,
      )
    }
  }
  console.log(`Computed ${count} variant value(s). Dry run — nothing written.`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
