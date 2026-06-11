// The slab comp algorithm: reduce a set of graded-card sales into one
// authoritative market value, with a confidence signal. Pure (no I/O) so it's
// unit-testable and shared by both the batch script (scripts/compute-slab-values.ts)
// and the admin instant-recompute path (src/lib/slab-comp-recompute.ts).
//
// Algorithm: recency-weighted trimmed median. See docs/slab-pricing.md.

// ── Tuning knobs (adjust here; no schema change needed) ──
export const WINDOWS_DAYS = [14, 30, 90, 180, 365] // narrowest first; short windows track a recent move, widen when thin
export const MIN_FOR_WINDOW = 3 // a window "counts" once it has at least this many sales
export const TRIM_LOW = 0.4 // drop sales below median * TRIM_LOW
export const TRIM_HIGH = 2.5 // drop sales above median * TRIM_HIGH
export const RECENCY_HALFLIFE_DAYS = 14 // weight = exp(-ageDays / HALFLIFE); shorter ⇒ recent sales dominate
export const TREND_LEAN_MAX = 0.5 // strongest-uptrend lean (capped at the 90th pct below)
export const TREND_LEAN_SCALE = 0.3 // intra-window trend at which the lean reaches ~63% of TREND_LEAN_MAX
export const LEAN_Q_CAP = 0.9 // never value above this recency-weighted percentile — don't chase the single top sale
export const LEAN_MIN_N = 6 // below this many sales: no lean at all (percentiles too coarse → overshoot, e.g. PSA 9)
export const LEAN_FULL_N = 16 // full lean at/above this many sales; ramp linearly from LEAN_MIN_N
export const HIGH_MIN_N = 8 // >= this many trimmed sales ...
export const HIGH_MAX_DISPERSION = 0.25 // ... and dispersion below this → "high"
export const MEDIUM_MIN_N = 3 // >= this many → "medium"
export const MAX_LOOKBACK_DAYS = WINDOWS_DAYS[WINDOWS_DAYS.length - 1]

export type Confidence = 'high' | 'medium' | 'low' | 'none'

export interface Sale {
  price: number
  soldAt: Date
}

/** Shaped to match the slab_market_values columns so it spreads straight into
 *  an upsert (`{ card_id, grading_company, grade, ...computeVariantValue() }`). */
export interface ComputedValue {
  market_value: number | null
  last_sold_price: number | null
  last_sold_at: string | null
  sample_size: number
  window_days: number
  dispersion: number | null
  confidence: Confidence
  trend_30d_pct: number | null
}

// ── Math helpers (exported for tests) ──
export function median(sorted: number[]): number {
  if (sorted.length === 0) return NaN
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function weightedQuantile(values: { v: number; w: number }[], q: number): number {
  const sorted = [...values].sort((a, b) => a.v - b.v)
  if (sorted.length === 0) return NaN
  const total = sorted.reduce((s, x) => s + x.w, 0)
  if (total <= 0) return median(sorted.map(x => x.v))
  const target = total * q
  let cum = 0
  for (const x of sorted) {
    cum += x.w
    if (cum >= target) return x.v
  }
  return sorted[sorted.length - 1].v
}

/** Recency/weight-aware median — the q=0.5 case of weightedQuantile. */
export function weightedMedian(values: { v: number; w: number }[]): number {
  return weightedQuantile(values, 0.5)
}

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length
}
function stddev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length)
}

/** Intra-window trajectory: newer-half vs older-half median. Detects a rise
 *  WITHIN our recent sales — the 30d-vs-prior-30d trend can't, since for a hot
 *  card eBay only returns the latest ~120 solds (no older baseline). */
function halfSplitTrend(sales: Sale[]): number | null {
  if (sales.length < 4) return null
  const byTime = [...sales].sort((a, b) => a.soldAt.getTime() - b.soldAt.getTime())
  const mid = Math.floor(byTime.length / 2)
  const older = median(byTime.slice(0, mid).map(s => s.price).sort((a, b) => a - b))
  const newer = median(byTime.slice(mid).map(s => s.price).sort((a, b) => a - b))
  return older > 0 ? newer / older - 1 : null
}

/** Reduce one variant's sales to a single value + confidence. `now` is passed
 *  in (not read from the clock) so callers stay deterministic / testable. */
export function computeVariantValue(sales: Sale[], now: Date): ComputedValue {
  const byRecent = [...sales].sort((a, b) => b.soldAt.getTime() - a.soldAt.getTime())
  const last = byRecent[0] ?? null
  const ageDays = (s: Sale) => (now.getTime() - s.soldAt.getTime()) / 86_400_000

  // Pick the narrowest window that clears MIN_FOR_WINDOW; else the widest.
  let windowDays = MAX_LOOKBACK_DAYS
  let windowed: Sale[] = []
  for (const w of WINDOWS_DAYS) {
    const inWindow = sales.filter(s => ageDays(s) <= w)
    if (inWindow.length >= MIN_FOR_WINDOW) {
      windowDays = w
      windowed = inWindow
      break
    }
    windowed = inWindow // remember the widest we saw
    windowDays = w
  }

  const base: ComputedValue = {
    market_value: null,
    last_sold_price: last ? last.price : null,
    last_sold_at: last ? last.soldAt.toISOString() : null,
    sample_size: 0,
    window_days: windowDays,
    dispersion: null,
    confidence: 'none',
    trend_30d_pct: null,
  }
  if (windowed.length === 0) return base

  // Anchor the outlier trim on the RECENCY-WEIGHTED median, not the flat window
  // median — so a genuine recent run-up isn't clipped (the band tracks the
  // current level) while one-off spikes and stale lows still get trimmed.
  const med0 = weightedMedian(windowed.map(s => ({ v: s.price, w: Math.exp(-ageDays(s) / RECENCY_HALFLIFE_DAYS) })))
  const kept = windowed.filter(s => s.price >= med0 * TRIM_LOW && s.price <= med0 * TRIM_HIGH)
  if (kept.length === 0) return base

  const weighted = kept.map(s => ({ v: s.price, w: Math.exp(-ageDays(s) / RECENCY_HALFLIFE_DAYS) }))
  const prices = kept.map(s => s.price)
  const disp = mean(prices) > 0 ? stddev(prices) / mean(prices) : 0

  const confidence: Confidence =
    kept.length >= HIGH_MIN_N && disp < HIGH_MAX_DISPERSION
      ? 'high'
      : kept.length >= MEDIUM_MIN_N
        ? 'medium'
        : 'low'

  // Trend: median of last 30d vs the prior 30d (need >= 2 each side). Computed
  // before the value so a strong uptrend can lean it toward the leading edge.
  const recent = sales.filter(s => ageDays(s) <= 30).map(s => s.price).sort((a, b) => a - b)
  const prior = sales.filter(s => ageDays(s) > 30 && ageDays(s) <= 60).map(s => s.price).sort((a, b) => a - b)
  let trend: number | null = null
  if (recent.length >= 2 && prior.length >= 2) {
    const pm = median(prior)
    if (pm > 0) trend = median(recent) / pm - 1
  }

  // Leading-edge value: in a clear uptrend the plain median lags — laggard
  // sellers still listing at yesterday's price drag it down — so lean toward a
  // higher recency-weighted percentile of the kept sales. q ramps 0.5 →
  // 0.5+TREND_LEAN_MAX with the trend (capped); flat/declining markets stay at
  // the median.
  const leanTrend = halfSplitTrend(kept)
  // Sample-size ramp: no lean under LEAN_MIN_N sales (thin grades' percentiles
  // overshoot), full lean at/above LEAN_FULL_N.
  const sizeFactor = Math.max(0, Math.min(1, (kept.length - LEAN_MIN_N) / (LEAN_FULL_N - LEAN_MIN_N)))
  const lean =
    leanTrend != null && leanTrend > 0
      ? TREND_LEAN_MAX * (1 - Math.exp(-leanTrend / TREND_LEAN_SCALE)) * sizeFactor
      : 0
  const value = weightedQuantile(weighted, Math.min(LEAN_Q_CAP, 0.5 + lean))

  return {
    market_value: Math.round(value * 100) / 100,
    last_sold_price: base.last_sold_price,
    last_sold_at: base.last_sold_at,
    sample_size: kept.length,
    window_days: windowDays,
    dispersion: Math.round(disp * 1000) / 1000,
    confidence,
    trend_30d_pct: trend == null ? null : Math.round(trend * 1000) / 1000,
  }
}

// ── Cross-grade imputation ────────────────────────────────────────────────
const PREMIUM_GRADERS = new Set(['PSA', 'BGS', 'CGC', 'SGC'])

/** Plain numeric grade for cross-grade comparison; null for special tiers
 *  (Black Label, Pristine) which command their own premium and shouldn't be
 *  imputed at parity. */
function numericGrade(grade: string): number | null {
  if (/black label|pristine/i.test(grade)) return null
  const m = grade.match(/\d+(?:\.\d+)?/)
  return m ? parseFloat(m[0]) : null
}

export interface CardGradeSales {
  company: string
  grade: string
  sales: Sale[]
}

/** Compute every grade of ONE card, then impute thin grades from a well-
 *  supported comparable. The gem-10 (or 9, 9.5…) of a card is broadly
 *  comparable across premium graders (PSA/BGS/CGC/SGC), so a rare grade with
 *  one stale sale — e.g. BGS 10 — inherits the confident grade's value instead
 *  of showing a misleading one-off, the way reference pricing apps do. Imputed
 *  values are flagged low confidence. Cheaper/niche graders (e.g. TAG) keep
 *  their own data — they trade well below the premium gem-10. */
export function computeCardValues(
  rows: CardGradeSales[],
  now: Date,
): (CardGradeSales & { value: ComputedValue })[] {
  type Computed = CardGradeSales & { value: ComputedValue }
  const out: Computed[] = rows.map(r => ({ ...r, value: computeVariantValue(r.sales, now) }))

  // Group premium graders by numeric grade; within each, a thin/low-confidence
  // grade inherits the most-supported confident grade's value.
  const byNum = new Map<number, Computed[]>()
  for (const o of out) {
    if (!PREMIUM_GRADERS.has(o.company)) continue
    const n = numericGrade(o.grade)
    if (n == null) continue
    const arr = byNum.get(n) ?? []
    arr.push(o)
    byNum.set(n, arr)
  }
  for (const group of byNum.values()) {
    const anchor = group
      .filter(o => (o.value.confidence === 'high' || o.value.confidence === 'medium') && o.value.market_value != null)
      .sort((a, b) => b.value.sample_size - a.value.sample_size)[0]
    if (!anchor) continue
    for (const o of group) {
      if (o === anchor) continue
      if (o.value.confidence === 'low' || o.value.confidence === 'none') {
        o.value = { ...o.value, market_value: anchor.value.market_value, confidence: 'low' }
      }
    }
  }
  return out
}
