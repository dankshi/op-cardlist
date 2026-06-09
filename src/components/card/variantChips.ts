/** Shared variant→chip model used by both the buy box (CardBuyPanel, which
 *  renders the *selected* variant) and the standalone grade selector
 *  (GradeSelector, which renders the full grade ladder). Keeping the
 *  canonical grade list + chip-building here means the two stay in lockstep:
 *  the grade you pick in the selector is the exact variant the buy box acts
 *  on, with no second source of truth. */

export interface VariantData {
  /** Stable variant key: 'raw' or '<company>-<grade>' (e.g. 'PSA-10'). */
  key: string
  /** Display label: 'Raw' or '<company> <grade>'. */
  label: string
  company: string | null
  grade: string | null
  /** Population count for this graded variant (0 for raw / no data). */
  population: number
  /** Computed market value for this graded variant (slab_market_values, with
   *  any admin override applied). Null when we have no comp for it. The grade
   *  ladder shows this as the "worth" estimate when there's no live listing. */
  marketValue: number | null
  /** Confidence of `marketValue` — drives how prominently the estimate renders. */
  marketConfidence: 'high' | 'medium' | 'low' | 'none' | null
  lowestListingId: string | null
  lowestListingPrice: number | null
  /** How many units of the lowest listing the seller still has. Drives
   *  the qty selector on Buy Now — capped at this value. Always 1 for
   *  graded slabs (each is a unique physical card). */
  lowestListingQuantityAvailable: number
  listingCount: number
}

export type CompanyKey = 'PSA' | 'BGS' | 'CGC' | 'TAG'

/** Company render order for the grouped grade ladder. */
export const COMPANY_ORDER: CompanyKey[] = ['PSA', 'BGS', 'TAG', 'CGC']

interface VariantDef {
  company: CompanyKey
  grade: string
  display: string // short label shown on the tile
  /** True if this grade is in the default (collapsed) view; false if it's
   *  only revealed by "Show all". This is a FIXED property of the grade —
   *  it never depends on the card's listings, so the default ladder looks
   *  identical on every card. */
  primary: boolean
}

/** Canonical grade list. Grouped by company, high grade first within each.
 *  The `primary` flag defines the always-visible default set:
 *    PSA 10/9 · BGS BL/10/9.5 · TAG 10 · CGC 10
 *  Everything else (BGS 9, the CGC/TAG lower grades, CGC Pristine) sits
 *  behind the "Show all" toggle. */
const ALL_VARIANTS: VariantDef[] = [
  { company: 'PSA', grade: '10',              display: '10',       primary: true  },
  { company: 'PSA', grade: '9',               display: '9',        primary: true  },
  { company: 'BGS', grade: 'Black Label 10',  display: 'BL',       primary: true  },
  { company: 'BGS', grade: '10',              display: '10',       primary: true  },
  { company: 'BGS', grade: '9.5',             display: '9.5',      primary: true  },
  { company: 'BGS', grade: '9',               display: '9',        primary: false },
  { company: 'TAG', grade: '10',              display: '10',       primary: true  },
  { company: 'TAG', grade: '9.5',             display: '9.5',      primary: false },
  { company: 'TAG', grade: '9',               display: '9',        primary: false },
  { company: 'CGC', grade: '10',              display: '10',       primary: true  },
  { company: 'CGC', grade: 'Pristine 10',     display: 'Pristine', primary: false },
  { company: 'CGC', grade: '9.5',             display: '9.5',      primary: false },
  { company: 'CGC', grade: '9',               display: '9',        primary: false },
]

export interface ChipData {
  key: string
  label: string                    // long label (e.g. "BGS Black Label 10")
  companyKey: CompanyKey | null
  /** Actual grade string (e.g. "Black Label 10") — fed to gradingStyle()
   *  so the tile renders the correct slab-label color treatment. */
  grade: string | null
  display: string | null           // short grade text on the tile face
  population: number
  /** Computed market value (slab_market_values + override) for this variant. */
  marketValue: number | null
  marketConfidence: 'high' | 'medium' | 'low' | 'none' | null
  lowestListingId: string | null
  lowestListingPrice: number | null
  /** Cap for the multi-quantity Buy Now selector. 0 when no listing. */
  lowestListingQuantityAvailable: number
  listingCount: number
  /** Part of the default (collapsed) view — see VariantDef.primary. */
  primary: boolean
}

/** Project the per-card `variants` onto the canonical grade ladder, filling
 *  in zero/empty data for grades nobody's listed. Always returns the same
 *  set of chips in the same order regardless of the card — listing data only
 *  changes the price/pop on each tile, never which tiles exist. */
export function buildChips(variants: VariantData[]): ChipData[] {
  const byKey = new Map<string, VariantData>()
  for (const v of variants) byKey.set(v.key, v)

  const raw = byKey.get('raw')
  const rawChip: ChipData = {
    key: 'raw',
    label: 'Ungraded NM',
    companyKey: null,
    grade: null,
    display: null,
    population: 0,
    // Raw cards value off the TCGplayer market price elsewhere, not the slab comp.
    marketValue: null,
    marketConfidence: null,
    lowestListingId: raw?.lowestListingId ?? null,
    lowestListingPrice: raw?.lowestListingPrice ?? null,
    lowestListingQuantityAvailable: raw?.lowestListingQuantityAvailable ?? 0,
    listingCount: raw?.listingCount ?? 0,
    primary: true,
  }

  const graded: ChipData[] = ALL_VARIANTS.map(def => {
    const key = `${def.company}-${def.grade}`
    const v = byKey.get(key)
    return {
      key,
      label: `${def.company} ${def.grade}`,
      companyKey: def.company,
      grade: def.grade,
      display: def.display,
      population: v?.population ?? 0,
      marketValue: v?.marketValue ?? null,
      marketConfidence: v?.marketConfidence ?? null,
      lowestListingId: v?.lowestListingId ?? null,
      lowestListingPrice: v?.lowestListingPrice ?? null,
      lowestListingQuantityAvailable: v?.lowestListingQuantityAvailable ?? 0,
      listingCount: v?.listingCount ?? 0,
      primary: def.primary,
    }
  })

  return [rawChip, ...graded]
}

/** Cheapest chip that actually has a listing — the sensible default
 *  selection. Falls back to 'raw' when nothing is listed. */
export function cheapestChipKey(chips: ChipData[]): string {
  const listed = chips.filter(c => c.lowestListingPrice != null)
  if (listed.length === 0) return 'raw'
  return listed.sort(
    (a, b) => (a.lowestListingPrice ?? 0) - (b.lowestListingPrice ?? 0),
  )[0].key
}
