/** Centralized grading-label color treatment.
 *
 *  Goal: visually match how the actual slab labels look so a Pristine 10
 *  reads as "elite" without the user having to know what Pristine means.
 *  Used by ConditionBadge (asks table) and CardBuyPanel (variant chips) so
 *  the same variant looks the same wherever it appears.
 *
 *  Tier system, loosely tracking the real-world holders:
 *   - Crown jewel (BL / Pristine 10): black + champagne gold
 *   - Pristine tier (BGS 10 / 9.5 + CGC Pristine sub-grades): solid gold
 *   - Gem Mint tier (PSA 10, CGC 10): bold company brand color
 *   - High tier (9 / 9.5 — non-pristine): standard company color
 *   - Raw / unknown: zinc fallback
 */

export interface GradingStyle {
  /** Full pill className — bg + text + ring + (optional) gradient. */
  pill: string
  /** True for the crown-jewel grades that get a star/sparkle accent. */
  isCrownJewel: boolean
  /** Compact label that fits in a tiny chip pill (e.g. "BGS BL"). */
  shortLabel: string
}

export function gradingStyle(
  company: string | null | undefined,
  grade: string | null | undefined,
): GradingStyle {
  if (!company || !grade) {
    return {
      pill: 'bg-zinc-900 text-white ring-zinc-900/20',
      isCrownJewel: false,
      shortLabel: '',
    }
  }
  const c = company.toUpperCase()
  const isBL = /black\s*label|\bbl\b/i.test(grade)
  const isPristine = /pristine/i.test(grade)

  // Crown jewel — BGS Black Label 10 + CGC Pristine 10. Both are "perfect
  // 10 across all subgrades" labels; black + gold says it.
  if (isBL || isPristine) {
    return {
      pill: 'bg-black text-amber-300 ring-amber-400/60',
      isCrownJewel: true,
      shortLabel: `${c} ${isBL ? 'BL' : 'Pristine'}`,
    }
  }

  // Per-company palettes for non-crown grades.
  if (c === 'PSA') {
    return {
      pill: 'bg-red-600 text-white ring-red-700',
      isCrownJewel: false,
      shortLabel: `PSA ${grade}`,
    }
  }
  if (c === 'BGS') {
    // BGS uses a gold label for 9.5/10 (the "Pristine" tier sans BL) and
    // silver for 9. Tracks the real Beckett holder colors.
    if (grade === '10' || grade === '9.5') {
      return {
        pill: 'bg-gradient-to-br from-amber-300 to-amber-500 text-amber-950 ring-amber-600',
        isCrownJewel: false,
        shortLabel: `BGS ${grade}`,
      }
    }
    if (grade === '9') {
      return {
        pill: 'bg-gradient-to-br from-zinc-200 to-zinc-400 text-zinc-900 ring-zinc-500',
        isCrownJewel: false,
        shortLabel: 'BGS 9',
      }
    }
    return {
      pill: 'bg-blue-700 text-white ring-blue-800',
      isCrownJewel: false,
      shortLabel: `BGS ${grade}`,
    }
  }
  if (c === 'CGC') {
    if (grade === '10') {
      // CGC Gem Mint 10 — green label IRL.
      return {
        pill: 'bg-emerald-600 text-white ring-emerald-700',
        isCrownJewel: false,
        shortLabel: 'CGC 10',
      }
    }
    return {
      pill: 'bg-amber-500 text-white ring-amber-600',
      isCrownJewel: false,
      shortLabel: `CGC ${grade}`,
    }
  }
  if (c === 'TAG') {
    return {
      pill: 'bg-emerald-700 text-white ring-emerald-800',
      isCrownJewel: false,
      shortLabel: `TAG ${grade}`,
    }
  }
  return {
    pill: 'bg-zinc-900 text-white ring-zinc-900/20',
    isCrownJewel: false,
    shortLabel: `${c} ${grade}`,
  }
}
