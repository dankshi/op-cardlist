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
 * Portfolio value over time. Raw holdings are valued off TCGplayer price history
 * (per product per day); graded slabs are valued off the slab comp history
 * (slab_market_value_history), falling back to the current comp for dates before
 * a snapshot exists — so a PSA 10 is valued at its comp, not the raw price.
 * Both sides forward-fill across a unified date axis so gaps don't dip the line.
 * Server-only. Sampled to MAX_POINTS.
 */
export async function getPortfolioValueSeries(
  holdings: Holding[],
  range: Range,
): Promise<{ series: ValuePoint[]; latestValue: number }> {
  if (!supabase || holdings.length === 0) return { series: [], latestValue: 0 }

  const days = RANGE_DAYS[range]
  const fromDate = days != null ? cutoffDate(days) : null

  const rawHoldings = holdings.filter(h => !(h.gradingCompany && h.grade))
  const gradedHoldings = holdings.filter(h => h.gradingCompany && h.grade)

  const [raw, graded] = await Promise.all([
    rawValueByDate(rawHoldings, fromDate),
    gradedValueByDate(gradedHoldings, fromDate),
  ])

  const allDates = [...new Set([...raw.dates, ...graded.dates])].sort()
  if (allDates.length === 0) {
    // No history on either side yet. If we still have a current graded total
    // (comp exists but no snapshots accumulated), show a flat line so the
    // slabs are reflected rather than dropping to zero.
    const total = graded.currentTotal
    if (total <= 0) return { series: [], latestValue: 0 }
    const start = fromDate ?? cutoffDate(30)
    const today = new Date().toISOString().slice(0, 10)
    return { series: [{ date: start, value: total }, { date: today, value: total }], latestValue: total }
  }

  // Forward-fill each side across the unified axis. Graded seeds at its current
  // total so dates before any snapshot still reflect the slabs' comp value.
  let lastRaw = 0
  let lastGraded = gradedHoldings.length ? graded.currentTotal : 0
  const full: ValuePoint[] = []
  for (const day of allDates) {
    if (raw.byDate.has(day)) lastRaw = raw.byDate.get(day)!
    if (graded.byDate.has(day)) lastGraded = graded.byDate.get(day)!
    full.push({ date: day, value: lastRaw + lastGraded })
  }

  let series = full
  if (full.length > MAX_POINTS) {
    const step = Math.ceil(full.length / MAX_POINTS)
    series = full.filter((_, i) => i % step === 0 || i === full.length - 1)
  }
  return { series, latestValue: series.length ? series[series.length - 1].value : 0 }
}

/** Raw (ungraded) holdings → value per date from TCGplayer price history. */
async function rawValueByDate(
  holdings: Holding[],
  fromDate: string | null,
): Promise<{ byDate: Map<string, number>; dates: string[] }> {
  const byDate = new Map<string, number>()
  if (!supabase || holdings.length === 0) return { byDate, dates: [] }

  const cardIds = [...new Set(holdings.map(h => h.cardId))]
  const { data: maps } = await supabase
    .from('card_tcgplayer_mapping')
    .select('card_id, tcgplayer_product_id')
    .in('card_id', cardIds)
  const productByCard = new Map<string, number>()
  for (const m of maps ?? []) {
    if (m.tcgplayer_product_id != null) productByCard.set(m.card_id as string, m.tcgplayer_product_id as number)
  }
  const qtyByProduct = new Map<number, number>()
  for (const h of holdings) {
    const pid = productByCard.get(h.cardId)
    if (pid == null) continue
    qtyByProduct.set(pid, (qtyByProduct.get(pid) ?? 0) + h.quantity)
  }
  const productIds = [...qtyByProduct.keys()]
  if (productIds.length === 0) return { byDate, dates: [] }

  const rows = await fetchAllHistory(productIds, fromDate)
  const pricesByDate = new Map<string, Map<number, number>>()
  for (const r of rows) {
    if (r.market_price == null) continue
    const day = r.recorded_date.slice(0, 10)
    let m = pricesByDate.get(day)
    if (!m) { m = new Map(); pricesByDate.set(day, m) }
    m.set(r.tcgplayer_product_id, Number(r.market_price))
  }
  const dates = [...pricesByDate.keys()].sort()
  const lastKnown = new Map<number, number>()
  for (const day of dates) {
    const dayPrices = pricesByDate.get(day)!
    let value = 0
    for (const [pid, qty] of qtyByProduct) {
      const here = dayPrices.get(pid)
      if (here != null) lastKnown.set(pid, here)
      const price = here ?? lastKnown.get(pid)
      if (price != null) value += price * qty
    }
    byDate.set(day, value)
  }
  return { byDate, dates }
}

/** Graded holdings → value per date from slab comp history, with the current
 *  comp (override-aware) as the fallback when a variant has no snapshot yet.
 *  Degrades gracefully if slab_market_value_history doesn't exist yet (the
 *  query errors → no dates → flat current-comp via currentTotal). */
async function gradedValueByDate(
  holdings: Holding[],
  fromDate: string | null,
): Promise<{ byDate: Map<string, number>; dates: string[]; currentTotal: number }> {
  const byDate = new Map<string, number>()
  if (!supabase || holdings.length === 0) return { byDate, dates: [], currentTotal: 0 }

  const qtyByKey = new Map<string, number>()
  const cardIds = new Set<string>()
  for (const h of holdings) {
    const key = `${h.cardId}|${h.gradingCompany}|${h.grade}`
    qtyByKey.set(key, (qtyByKey.get(key) ?? 0) + h.quantity)
    cardIds.add(h.cardId)
  }
  const cardIdArr = [...cardIds]

  let histQuery = supabase
    .from('slab_market_value_history')
    .select('card_id, grading_company, grade, recorded_date, market_value')
    .in('card_id', cardIdArr)
  if (fromDate) histQuery = histQuery.gte('recorded_date', fromDate)

  const [{ data: histRows }, { data: curRows }, { data: ovRows }] = await Promise.all([
    histQuery,
    supabase.from('slab_market_values').select('card_id, grading_company, grade, market_value').in('card_id', cardIdArr),
    supabase.from('slab_value_overrides').select('card_id, grading_company, grade, value').in('card_id', cardIdArr),
  ])

  // Current comp per key (override wins) — used for fallback + the latest point.
  const currentByKey = new Map<string, number>()
  for (const r of curRows ?? []) {
    if (r.market_value != null) currentByKey.set(`${r.card_id}|${r.grading_company}|${r.grade}`, Number(r.market_value))
  }
  for (const o of ovRows ?? []) {
    currentByKey.set(`${o.card_id}|${o.grading_company}|${o.grade}`, Number(o.value))
  }
  let currentTotal = 0
  for (const [key, qty] of qtyByKey) {
    const cur = currentByKey.get(key)
    if (cur != null) currentTotal += cur * qty
  }

  // History per key per date.
  const histByKey = new Map<string, Map<string, number>>()
  for (const r of histRows ?? []) {
    if (r.market_value == null) continue
    const key = `${r.card_id}|${r.grading_company}|${r.grade}`
    let m = histByKey.get(key)
    if (!m) { m = new Map(); histByKey.set(key, m) }
    m.set((r.recorded_date as string).slice(0, 10), Number(r.market_value))
  }

  const dateSet = new Set<string>()
  for (const m of histByKey.values()) for (const d of m.keys()) dateSet.add(d)
  const dates = [...dateSet].sort()

  const lastKnown = new Map<string, number>()
  for (const day of dates) {
    let value = 0
    for (const [key, qty] of qtyByKey) {
      const here = histByKey.get(key)?.get(day)
      if (here != null) lastKnown.set(key, here)
      const v = here ?? lastKnown.get(key) ?? currentByKey.get(key)
      if (v != null) value += v * qty
    }
    byDate.set(day, value)
  }

  return { byDate, dates, currentTotal }
}
