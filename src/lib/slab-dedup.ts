// Cross-source duplicate detection for slab_sales. When the same physical sale
// surfaces from more than one source (e.g. an eBay sale and the same slab
// re-reported on Alt), the comp engine would double-count it. This finds those
// likely-duplicate clusters so they can be collapsed. Pure (no I/O) so it's
// unit-testable; the DB side lives in scripts/dedup-slab-sales.ts.
//
// Two signals, in order of confidence:
//   1. cert  — same slab cert number across sources, close in time. Strong.
//   2. heuristic — same (card, company, grade), ~equal price, ~same date,
//                  different source. Weaker — surface for review, don't trust blindly.
//
// Within-source dupes are already handled by unique indexes (ebay_item_id /
// source_item_id), so this only ever forms cross-source clusters.

export interface DedupSale {
  id: string
  cardId: string
  company: string
  grade: string
  price: number
  soldAt: Date
  source: string
  certNumber: string | null
}

export interface DuplicateGroup {
  /** The sale to keep (highest-priority source, then earliest). */
  canonicalId: string
  /** The same-sale rows from other sources to collapse/hide. */
  duplicateIds: string[]
  confidence: 'cert' | 'heuristic'
  reason: string
}

// ── Tuning ──
export const PRICE_TOLERANCE = 0.02 // ±2% counts as the same price
export const DAYS_TOLERANCE = 2 // sold within this many days = same sale
// Canonical preference: the most primary/authoritative source wins.
const SOURCE_PRIORITY = ['ebay', 'goldin', 'fanatics', 'whatnot', 'alt', 'psa_apr', 'admin']

function sourceRank(source: string): number {
  const i = SOURCE_PRIORITY.indexOf(source)
  return i === -1 ? SOURCE_PRIORITY.length : i
}
function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 86_400_000
}
function priceClose(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(a, b) * PRICE_TOLERANCE
}

function pickCanonical(cluster: DedupSale[]): DedupSale {
  return [...cluster].sort((a, b) => {
    const ra = sourceRank(a.source), rb = sourceRank(b.source)
    if (ra !== rb) return ra - rb
    if (a.soldAt.getTime() !== b.soldAt.getTime()) return a.soldAt.getTime() - b.soldAt.getTime()
    return a.id.localeCompare(b.id)
  })[0]
}

/** Single-linkage cluster of sales whose sold dates chain within `days`. */
function clusterByDate(sales: DedupSale[], days: number): DedupSale[][] {
  const sorted = [...sales].sort((a, b) => a.soldAt.getTime() - b.soldAt.getTime())
  const clusters: DedupSale[][] = []
  let cur: DedupSale[] = []
  for (const s of sorted) {
    if (cur.length === 0 || daysBetween(cur[cur.length - 1].soldAt, s.soldAt) <= days) cur.push(s)
    else { clusters.push(cur); cur = [s] }
  }
  if (cur.length) clusters.push(cur)
  return clusters
}

/** Single-linkage cluster on (date within tolerance AND price within tolerance). */
function clusterHeuristic(sales: DedupSale[]): DedupSale[][] {
  const sorted = [...sales].sort((a, b) => a.soldAt.getTime() - b.soldAt.getTime())
  const clusters: DedupSale[][] = []
  for (const s of sorted) {
    const hit = clusters.find(c =>
      c.some(m => daysBetween(m.soldAt, s.soldAt) <= DAYS_TOLERANCE && priceClose(m.price, s.price)),
    )
    if (hit) hit.push(s)
    else clusters.push([s])
  }
  return clusters
}

function sources(cluster: DedupSale[]): string[] {
  return [...new Set(cluster.map(s => s.source))]
}

export function findCrossSourceDuplicates(sales: DedupSale[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = []
  const used = new Set<string>()

  // Pass 1 — cert. Same cert across ≥2 sources, close in time (a slab can
  // legitimately resell months apart, so still cluster by date).
  const byCert = new Map<string, DedupSale[]>()
  for (const s of sales) {
    if (!s.certNumber) continue
    const arr = byCert.get(s.certNumber) ?? []
    arr.push(s)
    byCert.set(s.certNumber, arr)
  }
  for (const arr of byCert.values()) {
    if (arr.length < 2) continue
    for (const cluster of clusterByDate(arr, DAYS_TOLERANCE)) {
      if (cluster.length < 2 || sources(cluster).length < 2) continue
      const canonical = pickCanonical(cluster)
      groups.push({
        canonicalId: canonical.id,
        duplicateIds: cluster.filter(s => s.id !== canonical.id).map(s => s.id),
        confidence: 'cert',
        reason: `same cert ${canonical.certNumber} across ${sources(cluster).join('+')}`,
      })
      for (const s of cluster) used.add(s.id)
    }
  }

  // Pass 2 — heuristic. Same variant, ~price, ~date, cross-source.
  const byVariant = new Map<string, DedupSale[]>()
  for (const s of sales) {
    if (used.has(s.id)) continue
    const k = `${s.cardId}|${s.company}|${s.grade}`
    const arr = byVariant.get(k) ?? []
    arr.push(s)
    byVariant.set(k, arr)
  }
  for (const arr of byVariant.values()) {
    for (const cluster of clusterHeuristic(arr)) {
      if (cluster.length < 2 || sources(cluster).length < 2) continue
      const canonical = pickCanonical(cluster)
      groups.push({
        canonicalId: canonical.id,
        duplicateIds: cluster.filter(s => s.id !== canonical.id).map(s => s.id),
        confidence: 'heuristic',
        reason: `~$${canonical.price} within ${DAYS_TOLERANCE}d across ${sources(cluster).join('+')}`,
      })
    }
  }

  return groups
}
