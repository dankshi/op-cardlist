import { supabase } from '@/lib/supabase'
import type { Holding } from './collection'

export type Range = '1W' | '1M' | '3M' | '1Y' | 'All'

const RANGE_DAYS: Record<Range, number | null> = {
  '1W': 7,
  '1M': 30,
  '3M': 90,
  '1Y': 365,
  All: null,
}

export interface ValuePoint {
  date: string
  value: number
}

/** Max points returned to the chart — keeps the payload + SVG light. */
const MAX_POINTS = 60

function cutoffDate(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

/** Page past Supabase's 1000-row default so a wide collection over a long
 *  range still returns every price-history row. */
async function fetchAllHistory(
  productIds: number[],
  fromDate: string | null,
): Promise<Array<{ tcgplayer_product_id: number; recorded_date: string; market_price: number | null }>> {
  if (!supabase || productIds.length === 0) return []
  const out: Array<{ tcgplayer_product_id: number; recorded_date: string; market_price: number | null }> = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    let q = supabase
      .from('tcgplayer_card_price_history')
      .select('tcgplayer_product_id, recorded_date, market_price')
      .in('tcgplayer_product_id', productIds)
      .order('recorded_date', { ascending: true })
      .range(from, from + pageSize - 1)
    if (fromDate) q = q.gte('recorded_date', fromDate)
    const { data, error } = await q
    if (error || !data || data.length === 0) break
    out.push(...data)
    if (data.length < pageSize) break
  }
  return out
}

/**
 * Portfolio value over time: for each recorded date, sum (market price on
 * that date × current quantity) across the holdings. Carries the last known
 * price forward for cards missing a row on a given date so gaps don't dip the
 * line to zero. Server-only (reads price history via the anon client).
 *
 * Two queries total (card→product map, then the history rows), then sampled
 * to MAX_POINTS — cheap even for large collections.
 */
export async function getPortfolioValueSeries(
  holdings: Holding[],
  range: Range,
): Promise<{ series: ValuePoint[]; latestValue: number }> {
  if (!supabase || holdings.length === 0) return { series: [], latestValue: 0 }

  const cardIds = [...new Set(holdings.map(h => h.cardId))]
  const { data: maps } = await supabase
    .from('card_tcgplayer_mapping')
    .select('card_id, tcgplayer_product_id')
    .in('card_id', cardIds)

  const productByCard = new Map<string, number>()
  for (const m of maps ?? []) {
    if (m.tcgplayer_product_id != null) productByCard.set(m.card_id as string, m.tcgplayer_product_id as number)
  }

  // Quantity per product (multiple holding lines can share a product/card).
  const qtyByProduct = new Map<number, number>()
  for (const h of holdings) {
    const pid = productByCard.get(h.cardId)
    if (pid == null) continue
    qtyByProduct.set(pid, (qtyByProduct.get(pid) ?? 0) + h.quantity)
  }
  const productIds = [...qtyByProduct.keys()]
  if (productIds.length === 0) return { series: [], latestValue: 0 }

  const days = RANGE_DAYS[range]
  const rows = await fetchAllHistory(productIds, days != null ? cutoffDate(days) : null)
  if (rows.length === 0) return { series: [], latestValue: 0 }

  // date -> (product -> price)
  const byDate = new Map<string, Map<number, number>>()
  for (const r of rows) {
    if (r.market_price == null) continue
    const day = r.recorded_date.slice(0, 10)
    let m = byDate.get(day)
    if (!m) { m = new Map(); byDate.set(day, m) }
    m.set(r.tcgplayer_product_id, Number(r.market_price))
  }

  const dates = [...byDate.keys()].sort()
  const lastKnown = new Map<number, number>()
  const full: ValuePoint[] = []
  for (const day of dates) {
    const dayPrices = byDate.get(day)!
    let value = 0
    for (const [pid, qty] of qtyByProduct) {
      const here = dayPrices.get(pid)
      if (here != null) lastKnown.set(pid, here)
      const price = here ?? lastKnown.get(pid)
      if (price != null) value += price * qty
    }
    full.push({ date: day, value })
  }

  // Down-sample evenly to MAX_POINTS, always keeping the most recent point.
  let series = full
  if (full.length > MAX_POINTS) {
    const step = Math.ceil(full.length / MAX_POINTS)
    series = full.filter((_, i) => i % step === 0 || i === full.length - 1)
  }

  return { series, latestValue: series.length ? series[series.length - 1].value : 0 }
}
