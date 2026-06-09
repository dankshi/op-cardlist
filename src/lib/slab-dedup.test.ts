import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findCrossSourceDuplicates, type DedupSale } from './slab-dedup'

const DAY = 86_400_000
const BASE = new Date('2026-06-01T00:00:00Z')
function d(offsetDays: number): Date {
  return new Date(BASE.getTime() + offsetDays * DAY)
}
let n = 0
function sale(p: Partial<DedupSale>): DedupSale {
  return {
    id: p.id ?? `s${n++}`,
    cardId: p.cardId ?? 'OP07-051',
    company: p.company ?? 'PSA',
    grade: p.grade ?? '10',
    price: p.price ?? 100,
    soldAt: p.soldAt ?? d(0),
    source: p.source ?? 'ebay',
    certNumber: p.certNumber ?? null,
  }
}

test('no duplicates when all sales are from the same source', () => {
  const groups = findCrossSourceDuplicates([
    sale({ id: 'a', source: 'ebay', price: 100, soldAt: d(0) }),
    sale({ id: 'b', source: 'ebay', price: 100, soldAt: d(0) }),
  ])
  assert.equal(groups.length, 0)
})

test('cert match across sources → cert-confidence group', () => {
  const groups = findCrossSourceDuplicates([
    sale({ id: 'ebay1', source: 'ebay', certNumber: '12345678', price: 400, soldAt: d(0) }),
    sale({ id: 'alt1', source: 'alt', certNumber: '12345678', price: 405, soldAt: d(1) }),
  ])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].confidence, 'cert')
  assert.equal(groups[0].canonicalId, 'ebay1') // eBay outranks alt
  assert.deepEqual(groups[0].duplicateIds, ['alt1'])
})

test('same cert but months apart = legitimate resale, not a dup', () => {
  const groups = findCrossSourceDuplicates([
    sale({ id: 'a', source: 'ebay', certNumber: '999', price: 400, soldAt: d(0) }),
    sale({ id: 'b', source: 'alt', certNumber: '999', price: 600, soldAt: d(120) }),
  ])
  assert.equal(groups.length, 0)
})

test('heuristic: ~same price + date across sources → heuristic group', () => {
  const groups = findCrossSourceDuplicates([
    sale({ id: 'ebay1', source: 'ebay', price: 500, soldAt: d(0) }),
    sale({ id: 'alt1', source: 'alt', price: 505, soldAt: d(1) }), // within 2% and 2 days
  ])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].confidence, 'heuristic')
  assert.equal(groups[0].canonicalId, 'ebay1')
})

test('cross-source but different price = two real sales, not a dup', () => {
  const groups = findCrossSourceDuplicates([
    sale({ id: 'a', source: 'ebay', price: 500, soldAt: d(0) }),
    sale({ id: 'b', source: 'alt', price: 650, soldAt: d(0) }),
  ])
  assert.equal(groups.length, 0)
})

test('cross-source same price but far apart in time = not a dup', () => {
  const groups = findCrossSourceDuplicates([
    sale({ id: 'a', source: 'ebay', price: 500, soldAt: d(0) }),
    sale({ id: 'b', source: 'alt', price: 500, soldAt: d(10) }),
  ])
  assert.equal(groups.length, 0)
})

test('different variants never merge', () => {
  const groups = findCrossSourceDuplicates([
    sale({ id: 'a', source: 'ebay', grade: '10', price: 500, soldAt: d(0) }),
    sale({ id: 'b', source: 'alt', grade: '9', price: 500, soldAt: d(0) }),
  ])
  assert.equal(groups.length, 0)
})

test('cert pass takes precedence over heuristic for the same rows', () => {
  // Two sales that match on BOTH cert and heuristic — should report once, as cert.
  const groups = findCrossSourceDuplicates([
    sale({ id: 'a', source: 'ebay', certNumber: 'X1', price: 300, soldAt: d(0) }),
    sale({ id: 'b', source: 'alt', certNumber: 'X1', price: 300, soldAt: d(0) }),
  ])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].confidence, 'cert')
})
