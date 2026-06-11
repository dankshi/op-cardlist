import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeVariantValue, computeCardValues, weightedMedian, median, type Sale } from './slab-comp'

const NOW = new Date('2026-06-08T00:00:00Z')
function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 86_400_000)
}
function sale(price: number, ageDays: number): Sale {
  return { price, soldAt: daysAgo(ageDays) }
}

test('median — odd and even', () => {
  assert.equal(median([1, 2, 3]), 2)
  assert.equal(median([1, 2, 3, 4]), 2.5)
  assert.ok(Number.isNaN(median([])))
})

test('weightedMedian — equal weights matches median', () => {
  const vs = [10, 20, 30].map(v => ({ v, w: 1 }))
  assert.equal(weightedMedian(vs), 20)
})

test('weightedMedian — heavy weight pulls toward that value', () => {
  const vs = [{ v: 10, w: 1 }, { v: 100, w: 100 }]
  assert.equal(weightedMedian(vs), 100)
})

test('no sales → confidence none, null value', () => {
  const c = computeVariantValue([], NOW)
  assert.equal(c.confidence, 'none')
  assert.equal(c.market_value, null)
  assert.equal(c.sample_size, 0)
})

test('tight cluster of many recent sales → high confidence', () => {
  const sales = Array.from({ length: 10 }, (_, i) => sale(100 + (i % 3), i)) // ~100, all within 10d
  const c = computeVariantValue(sales, NOW)
  assert.equal(c.confidence, 'high')
  assert.ok(c.market_value! >= 99 && c.market_value! <= 103)
  assert.equal(c.sample_size, 10)
})

test('a lot/bundle outlier is trimmed out of the value', () => {
  // Nine ~$100 sales + one $5,000 "lot" listing. The trim must drop the lot so
  // the value stays near 100, not dragged up.
  const sales = [...Array.from({ length: 9 }, (_, i) => sale(100, i)), sale(5000, 1)]
  const c = computeVariantValue(sales, NOW)
  assert.ok(c.market_value! < 120, `expected ~100, got ${c.market_value}`)
  assert.equal(c.sample_size, 9) // the lot was trimmed
})

test('1-2 sales → low confidence', () => {
  const c = computeVariantValue([sale(250, 5), sale(260, 10)], NOW)
  assert.equal(c.confidence, 'low')
})

test('recency weighting favors recent sales when the market moved', () => {
  // Old sales ~100 (40-60d ago), recent sales ~200 (0-5d ago). The recency
  // weight should pull the value above the unweighted median of 150.
  const sales = [
    sale(100, 40), sale(100, 50), sale(100, 60),
    sale(200, 0), sale(200, 2), sale(200, 5),
  ]
  const c = computeVariantValue(sales, NOW)
  assert.ok(c.market_value! > 150, `expected >150 from recency weighting, got ${c.market_value}`)
})

test('strong uptrend leans the value above the plain median', () => {
  // 12 sales rising ~100 (oldest) → ~300 (newest). Plain median ~199, but the
  // leading-edge lean should pull the value above it (laggard-priced sales
  // shouldn't define the value in a clearly rising market).
  const sales = Array.from({ length: 12 }, (_, i) => sale(100 + i * 18, 12 - i)) // ages 12..1
  const c = computeVariantValue(sales, NOW)
  const plainMedian = median(sales.map(s => s.price).sort((a, b) => a - b))
  assert.ok(c.market_value! > plainMedian, `expected lean above median ${plainMedian}, got ${c.market_value}`)
})

test('flat market stays at the median (no lean)', () => {
  const sales = Array.from({ length: 12 }, (_, i) => sale(100 + (i % 2), i)) // ~100, no trend
  const c = computeVariantValue(sales, NOW)
  assert.ok(c.market_value! >= 99 && c.market_value! <= 102, `expected ~100, got ${c.market_value}`)
})

test('cross-grade imputation lifts a thin premium grade; cheaper graders keep their own', () => {
  const out = computeCardValues(
    [
      { company: 'PSA', grade: '10', sales: Array.from({ length: 10 }, (_, i) => sale(1000, i)) }, // confident anchor
      { company: 'BGS', grade: '10', sales: [sale(400, 30)] }, // one stale sale → thin
      { company: 'TAG', grade: '10', sales: [sale(300, 30)] }, // cheaper grader → not imputed
    ],
    NOW,
  )
  const v = (co: string) => out.find(o => o.company === co)!.value
  assert.ok(v('PSA').market_value! >= 990 && v('PSA').market_value! <= 1010)
  assert.equal(v('BGS').market_value, v('PSA').market_value) // BGS 10 inherits PSA 10
  assert.equal(v('BGS').confidence, 'low') // flagged estimated
  assert.equal(v('TAG').market_value, 300) // TAG keeps its own — not lifted to the premium gem-10
})

test('trend is positive when recent 30d exceeds prior 30d', () => {
  const sales = [
    sale(100, 45), sale(100, 50), // prior window (31-60d)
    sale(150, 5), sale(150, 10),  // recent window (<=30d)
  ]
  const c = computeVariantValue(sales, NOW)
  assert.ok(c.trend_30d_pct != null && c.trend_30d_pct > 0)
})
