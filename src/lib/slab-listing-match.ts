// Variant-consistency check for eBay graded-sale listings. The search query is
// anchored on a card's set code, but eBay search is fuzzy — a base-card search
// can return the (far pricier) alt-art parallel and vice-versa. Mis-attributing
// one parallel's sale to another variant poisons that variant's comp, so we
// cross-check the listing title's variant signal against the target variant.
//
// Deliberately coarse (base vs special): titles reliably indicate *whether* a
// card is a special print (they say "alt art" / "manga" / "parallel"), but not
// reliably *which* parallel. Distinguishing among parallels is left to the
// comp's outlier trim + admin review. Pure — unit-tested in slab-listing-match.test.ts.

// Explicit special-print signals. Multi-word/unambiguous only — we avoid bare
// "sp"/"sec" (too many false positives like "spider"/"second").
const SPECIAL_TITLE = /\b(alt(?:ernate)?\s*art|parallel|manga|wanted(?:\s*poster)?|super\s*alt(?:ernate)?|full\s*art|textured|box\s*topper|treasure|special\s*art|secret\s*rare)\b/i

// Special signal in a TCGplayer product name (used to classify the *target*).
const SPECIAL_TCG = /(alt|parallel|manga|wanted|super|full\s*art|textured|treasure|box\s*topper|secret|special)/i

export type ExpectedVariant = 'base' | 'special'
export type MatchResult = 'match' | 'mismatch' | 'uncertain'

/** True when the listing title explicitly names a special print. */
export function titleIsSpecialVariant(title: string): boolean {
  return SPECIAL_TITLE.test(title)
}

/** The variant we expect for a scrape target, from its card_id parallel suffix
 *  (e.g. `OP13-118_p3`) and/or its TCGplayer product name. */
export function expectedVariant(cardId: string, tcgName: string | null): ExpectedVariant {
  if (/_p\d/i.test(cardId)) return 'special'
  if (tcgName && SPECIAL_TCG.test(tcgName)) return 'special'
  return 'base'
}

/**
 * Compare a listing title against the target's expected variant.
 *   - base target + special title  → 'mismatch' (a parallel leaked into a base
 *     search; the sale belongs to a different card — drop it).
 *   - special target + no special signal → 'uncertain' (could be a terse alt-art
 *     listing, or a base card leaking in — keep but flag for review).
 *   - otherwise → 'match'.
 * Conservative by construction: we only declare a hard mismatch on a *positive*
 * contradiction, never on the mere absence of a keyword, so terse-but-legit
 * listings aren't silently dropped.
 */
export function variantMatch(expected: ExpectedVariant, title: string): MatchResult {
  const titleSpecial = titleIsSpecialVariant(title)
  if (expected === 'base') return titleSpecial ? 'mismatch' : 'match'
  return titleSpecial ? 'match' : 'uncertain'
}
