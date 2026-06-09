/** Single source of truth for card visibility — kept DEPENDENCY-FREE on purpose.
 *
 *  The storefront (src/lib/cards.ts) and the scraper (scripts/scrape-prices.ts,
 *  run via tsx) both need this predicate. cards.ts pulls in React + the supabase
 *  client, which can't/shouldn't be imported into the standalone scraper, so the
 *  rule lives here with zero imports and both sides share it. Don't add imports
 *  to this file.
 */

/** Base rarities we don't sell standard prints of. Their alt arts, manga
 *  variants, and wanted-poster variants are still sellable — see
 *  `isHiddenByFields`. Higher rarities (SP, TR, SEC) are always shown.
 *  L (Leader) standard prints are hidden too — only their alt art /
 *  parallel versions have collector value. */
export const HIDDEN_RARITIES: Set<string> = new Set(['C', 'UC', 'R', 'P', 'SR', 'L']);

/** Centralized visibility rule. Every surface (set pages, search, admin/cards,
 *  admin/mappings, admin/psa-pops, card "Other Versions") and the scraper route
 *  through this so a rule change here propagates everywhere.
 *
 *  Operates on raw field values (the Supabase column shapes: `set_id`,
 *  `art_style`, etc.) so it works for both Card models and raw rows.
 *
 *  Current rules:
 *  1. Low-rarity standard prints — base C/UC/R/P/SR/L cards with no variant
 *     treatment. Their alt arts / manga / wanted / textured variants stay
 *     visible.
 *  2. PRB-01 Event/Stage cards (every variant) — the foil/Reprint non-character
 *     reprints are noise, not worth listing. */
export function isHiddenByFields(
  setId: string | null,
  type: string | null,
  rarity: string | null,
  artStyle: string | null,
): boolean {
  if (rarity && HIDDEN_RARITIES.has(rarity) && (artStyle ?? 'standard') === 'standard') return true;
  if (setId === 'prb-01' && (type === 'EVENT' || type === 'STAGE')) return true;
  return false;
}
