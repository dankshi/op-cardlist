import type { SupabaseClient } from '@supabase/supabase-js'
import { computeVariantValue, MAX_LOOKBACK_DAYS, type Sale } from './slab-comp'

/** Recompute slab_market_values from slab_sales and upsert the results.
 *
 *  - No `cardIds` → full recompute across the catalog (the batch script path).
 *  - With `cardIds` → targeted recompute for just those cards (the admin
 *    instant-recompute path after a curation edit). In targeted mode we first
 *    DELETE the affected variants, so excluding the *last* visible sale for a
 *    variant correctly removes its value instead of leaving a stale row.
 *
 *  Requires a service-role client (slab_sales reads are RLS-limited to visible
 *  for anon; the comp must see exactly the visible+sold set, which the
 *  service-role client gets directly via the query filters below).
 *
 *  Returns the number of variant values written. */
export async function recomputeSlabCards(
  admin: SupabaseClient,
  opts: { cardIds?: string[] } = {},
): Promise<number> {
  const since = new Date()
  since.setDate(since.getDate() - MAX_LOOKBACK_DAYS)

  let query = admin
    .from('slab_sales')
    .select('card_id, grading_company, grade, price, sold_at')
    .eq('status', 'visible')
    .eq('sale_kind', 'sold')
    .gte('sold_at', since.toISOString())
  if (opts.cardIds?.length) query = query.in('card_id', opts.cardIds)

  const { data: rows, error } = await query
  if (error) throw error

  interface Group { cardId: string; company: string; grade: string; sales: Sale[] }
  const groups = new Map<string, Group>()
  for (const r of rows ?? []) {
    const price = Number(r.price)
    if (!Number.isFinite(price) || price <= 0) continue
    const k = `${r.card_id}|${r.grading_company}|${r.grade}`
    let g = groups.get(k)
    if (!g) {
      g = { cardId: r.card_id as string, company: r.grading_company as string, grade: r.grade as string, sales: [] }
      groups.set(k, g)
    }
    g.sales.push({ price, soldAt: new Date(r.sold_at as string) })
  }

  const now = new Date()
  const upserts = [...groups.values()].map(g => ({
    card_id: g.cardId,
    grading_company: g.company,
    grade: g.grade,
    ...computeVariantValue(g.sales, now),
    computed_at: now.toISOString(),
  }))

  // Targeted mode: clear the affected cards first so variants that lost their
  // last visible sale don't keep a stale value.
  if (opts.cardIds?.length) {
    const { error: delErr } = await admin.from('slab_market_values').delete().in('card_id', opts.cardIds)
    if (delErr) throw delErr
  }

  const CHUNK = 500
  let written = 0
  for (let i = 0; i < upserts.length; i += CHUNK) {
    const chunk = upserts.slice(i, i + CHUNK)
    const { error: upErr } = await admin
      .from('slab_market_values')
      .upsert(chunk, { onConflict: 'card_id,grading_company,grade' })
    if (upErr) throw upErr
    written += chunk.length
  }
  return written
}
