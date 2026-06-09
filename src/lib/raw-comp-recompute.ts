import type { SupabaseClient } from '@supabase/supabase-js'
import { computeVariantValue, MAX_LOOKBACK_DAYS, type Sale } from './slab-comp'

/** The only condition we value for now — TCGplayer's headline market price is
 *  Near Mint, so valuing NM keeps "ours" and "theirs" directly comparable. */
export const RAW_CONDITION = 'Near Mint'

/** Recompute raw_market_values from the card_sales ledger and upsert.
 *
 *  - No `productIds` → full recompute across every product (backfill script).
 *  - With `productIds` → targeted recompute for just those products (the sales
 *    scraper calls this for the window it just refreshed). A product with no
 *    in-window NM sales simply gets a 'none'/null row, which is correct.
 *
 *  The raw analog of recomputeSlabCards — same algorithm (slab-comp.ts), grouped
 *  by (product, condition) instead of (card, company, grade). Requires a
 *  service-role client. Returns the number of product values written. */
export async function recomputeRawValues(
  admin: SupabaseClient,
  opts: { productIds?: number[] } = {},
): Promise<number> {
  const since = new Date()
  since.setDate(since.getDate() - MAX_LOOKBACK_DAYS)

  // card_sales is large, so paginate. A query builder is single-use once
  // awaited, so rebuild it per page.
  const buildBase = () => {
    let q = admin
      .from('card_sales')
      .select('tcgplayer_product_id, price, sold_at')
      .eq('condition', RAW_CONDITION)
      .gte('sold_at', since.toISOString())
    if (opts.productIds?.length) q = q.in('tcgplayer_product_id', opts.productIds)
    return q
  }

  const rows: { tcgplayer_product_id: number; price: number | string; sold_at: string }[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildBase().range(from, from + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    rows.push(...(data as typeof rows))
    if (data.length < PAGE) break
  }

  const groups = new Map<number, { productId: number; sales: Sale[] }>()
  for (const r of rows) {
    const price = Number(r.price)
    if (!Number.isFinite(price) || price <= 0) continue
    const pid = r.tcgplayer_product_id
    let g = groups.get(pid)
    if (!g) { g = { productId: pid, sales: [] }; groups.set(pid, g) }
    g.sales.push({ price, soldAt: new Date(r.sold_at) })
  }

  const now = new Date()
  const upserts = [...groups.values()].map(g => ({
    tcgplayer_product_id: g.productId,
    condition: RAW_CONDITION,
    ...computeVariantValue(g.sales, now),
    computed_at: now.toISOString(),
  }))

  const CHUNK = 500
  let written = 0
  for (let i = 0; i < upserts.length; i += CHUNK) {
    const chunk = upserts.slice(i, i + CHUNK)
    const { error } = await admin
      .from('raw_market_values')
      .upsert(chunk, { onConflict: 'tcgplayer_product_id,condition' })
    if (error) throw error
    written += chunk.length
  }
  return written
}
