import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeVariantValue, weightedMedian, median, type Sale } from './slab-comp'

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

test('trend is positive when recent 30d exceeds prior 30d', () => {
  const sales = [
    sale(100, 45), sale(100, 50), // prior window (31-60d)
    sale(150, 5), sale(150, 10),  // recent window (<=30d)
  ]
  const c = computeVariantValue(sales, NOW)
  assert.ok(c.trend_30d_pct != null && c.trend_30d_pct > 0)
})
