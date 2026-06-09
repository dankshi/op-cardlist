// Find (and optionally collapse) cross-source duplicate slab sales so the comp
// engine doesn't double-count the same physical sale reported by two sources.
// See src/lib/slab-dedup.ts for the detection logic and docs/slab-pricing.md.
//
// Conservative by design: --apply only hides HIGH-confidence (cert) duplicates.
// Heuristic matches are always report-only — they're surfaced for a human to
// review/exclude on /admin/slab-sales rather than collapsed automatically.
//
// Usage:
//   npx tsx scripts/dedup-slab-sales.ts            # report only (default)
//   npx tsx scripts/dedup-slab-sales.ts --apply    # hide cert-confidence dups + recompute

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { findCrossSourceDuplicates, type DedupSale } from '../src/lib/slab-dedup'
import { recomputeSlabCards } from '../src/lib/slab-comp-recompute'

dotenv.config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const LOOKBACK_DAYS = 365

async function main() {
  const apply = process.argv.includes('--apply')

  const since = new Date()
  since.setDate(since.getDate() - LOOKBACK_DAYS)
  const { data: rows, error } = await supabase
    .from('slab_sales')
    .select('id, card_id, grading_company, grade, price, sold_at, source, cert_number')
    .eq('status', 'visible')
    .eq('sale_kind', 'sold')
    .gte('sold_at', since.toISOString())
  if (error) {
    console.error('Query failed:', error.message)
    process.exit(1)
  }

  const sales: DedupSale[] = (rows ?? []).map(r => ({
    id: String(r.id),
    cardId: r.card_id as string,
    company: r.grading_company as string,
    grade: r.grade as string,
    price: Number(r.price),
    soldAt: new Date(r.sold_at as string),
    source: r.source as string,
    certNumber: (r.cert_number as string | null) ?? null,
  }))

  const groups = findCrossSourceDuplicates(sales)
  const cert = groups.filter(g => g.confidence === 'cert')
  const heuristic = groups.filter(g => g.confidence === 'heuristic')
  console.log(`Scanned ${sales.length} visible sold sales → ${cert.length} cert dup group(s), ${heuristic.length} heuristic group(s).`)

  for (const g of heuristic) {
    console.log(`  [review] keep ${g.canonicalId}, possible dups ${g.duplicateIds.join(',')} — ${g.reason}`)
  }
  for (const g of cert) {
    console.log(`  [cert]   keep ${g.canonicalId}, dups ${g.duplicateIds.join(',')} — ${g.reason}`)
  }

  if (!apply) {
    console.log('\nReport only. Re-run with --apply to hide cert-confidence duplicates.')
    return
  }

  const idById = new Map(sales.map(s => [s.id, s]))
  const toHide: string[] = []
  const affectedCards = new Set<string>()
  for (const g of cert) {
    for (const id of g.duplicateIds) {
      toHide.push(id)
      const s = idById.get(id)
      if (s) affectedCards.add(s.cardId)
    }
  }
  if (toHide.length === 0) {
    console.log('\nNothing to apply (no cert-confidence duplicates).')
    return
  }

  const { error: updErr } = await supabase
    .from('slab_sales')
    .update({ status: 'hidden', excluded_reason: 'cross-source duplicate (cert)', reviewed_at: new Date().toISOString() })
    .in('id', toHide)
  if (updErr) {
    console.error('Hide failed:', updErr.message)
    process.exit(1)
  }
  console.log(`\nHid ${toHide.length} duplicate(s); recomputing ${affectedCards.size} card(s)...`)
  await recomputeSlabCards(supabase, { cardIds: [...affectedCards] })
  console.log('Done.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
