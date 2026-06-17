import type { CardCondition } from '@/types/database'

/** A single owned line: N copies of a card in one condition/grade, with the
 *  cost basis the collector paid (null if they never recorded it). */
export interface Holding {
  cardId: string
  condition: CardCondition | null
  quantity: number
  acquiredPrice: number | null
  /** Set for graded slabs — lets the portfolio time-series value them off the
   *  slab comp history instead of the raw TCGplayer price. Null/undefined = raw. */
  gradingCompany?: string | null
  grade?: string | null
}

/** Resolve the per-line market price for one holding, in priority order:
 *    1. explicit custom override (the owner pinned a value)
 *    2. graded only: the computed slab comp value (slab_market_values + override)
 *    3. graded only: the lowest active graded listing for that exact grade
 *    4. ungraded only: the raw TCGplayer market price
 *  A graded slab NEVER falls back to the raw price — a BGS 10 is worth a large
 *  multiple of the ungraded card, so the raw price is misleading. With no slab
 *  signal it returns null, so the UI can surface "no estimate" (and prompt for a
 *  custom value) instead of a wrong number. Centralized so every surface that
 *  values a collection agrees — a PSA 10 is worth the same number everywhere. */
export function holdingMarketPrice(opts: {
  customValue: number | null
  isGraded: boolean
  slabValue: number | null
  gradedListing: number | null
  rawMarket: number | null
}): number | null {
  const { customValue, isGraded, slabValue, gradedListing, rawMarket } = opts
  if (customValue != null) return customValue
  if (isGraded) return slabValue ?? gradedListing
  return rawMarket
}

/** Roll up already-valued holding lines into portfolio totals. Market value
 *  is resolved per-line upstream (raw vs graded price differ for the same
 *  card), so this works on computed currentValue/costBasis rather than a
 *  per-card price map. Gain is measured over the *invested* portion only
 *  (lines with a known cost basis) so no-basis cards don't read as pure
 *  profit. */
export function summarize(
  items: Array<{ quantity: number; currentValue: number | null; costBasis: number | null }>,
): {
  totalValue: number
  totalCost: number
  totalGain: number
  totalGainPct: number | null
  cardCount: number
} {
  let totalValue = 0
  let totalCost = 0
  let investedValue = 0
  let cardCount = 0

  for (const h of items) {
    cardCount += h.quantity
    if (h.currentValue != null) totalValue += h.currentValue
    if (h.costBasis != null) {
      totalCost += h.costBasis
      if (h.currentValue != null) investedValue += h.currentValue
    }
  }

  const totalGain = investedValue - totalCost
  return {
    totalValue,
    totalCost,
    totalGain,
    totalGainPct: totalCost > 0 ? totalGain / totalCost : null,
    cardCount,
  }
}
