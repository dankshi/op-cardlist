// Pulls PSA population data via PSA's internal /Pop/GetSetItems endpoint
// — the same JSON call psacard.com's own pop pages make. PSA's public
// API has no set-level pop endpoint, so we cookie-auth against the
// website backend instead.
//
// Writes everything (catalog metadata + per-grade pop counts) to the
// single pops_psa table. Per-grade columns (grade_10, grade_9, ...) live
// inline; we always write them, even for unmapped specs, since the
// catalog is useful regardless of whether a card_id is known yet.
//
// Auto-matching by PSA Variety field:
//   ""                       → exact base card_id (no _p suffix), in this set
//   "Alternate Art"          → _p sibling in this set whose name has
//                              "(Parallel)" but not "(Manga)" / "(SP)" / "(TR)"
//   "Manga Alternate Art"    → _p sibling in this set whose name has "(Manga)"
//   "Special Alternate Art"  → _p sibling in *any* set with matching
//                              CardNumber + normalized subject name + "(SP)"
//   "Treasure Rare"          → same as SP but with "(TR)" marker
//   anything else            → unmapped (Pre-Release, Don!! Card, etc.)
// All rules require exactly one unclaimed candidate to avoid ambiguity.
//
// SP / TR specs are cross-set because PSA reuses the original print's
// CardNumber for reprints — e.g. Ace's OP08 SP has CardNumber 013 but
// lives in our DB at OP02-013_p3 (where Ace first appeared).
//
// Cookies: the endpoint is behind Cloudflare bot protection. Copy the
// full Cookie header from a logged-in PSA browser session (Chrome
// DevTools → Network → any psacard.com XHR → Headers → "cookie") and
// put it in .env.local as PSA_WEB_COOKIE. The cf_clearance cookie
// inside that string expires periodically (hours to a day); when fetches
// start returning 403, refresh the cookie from your browser.
//
// Usage:
//   npx tsx scripts/psa-pop-fetch.ts              # all configured PSA sets
//   npx tsx scripts/psa-pop-fetch.ts OP08         # one set only (our set code)
//   npx tsx scripts/psa-pop-fetch.ts --rematch    # re-derive every card_id
//   npx tsx scripts/psa-pop-fetch.ts OP08 --rematch
//
// --rematch ignores the existing pops_psa.card_id values and re-runs
// auto-match against current TCGplayer data. Use this after fixing a
// batch of wrong TCGplayer mappings to refresh any PSA matches that
// were derived from the old (wrong) name.
//
// Env:  PSA_WEB_COOKIE  full Cookie header value copied from browser

import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

const PSA_WEB_COOKIE = process.env.PSA_WEB_COOKIE;
if (!PSA_WEB_COOKIE) {
  console.error('Missing PSA_WEB_COOKIE in .env.local — copy the Cookie header from a logged-in psacard.com browser session.');
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase env vars');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

// Map our set codes to PSA's internal Set IDs. PSA Set IDs live in the
// URL of the set's pop report, e.g.
//   https://www.psacard.com/pop/tcg-cards/2024/one-piece-op08-two-legends/280554
//                                                                        ^^^^^^
// alsoCheckSetCodes covers the case where one PSA set page bundles cards
// from multiple of our set codes (e.g. PSA's "OP14 - EB04" page contains
// both OP14 and EB04 cards). The matcher tries the primary code first,
// then any fallbacks.
// `code` = PSA's CardNumber prefix (no hyphen, e.g. 'OP01', 'PRB02')
// `setCode` = our DB's cards.set_id format (lowercased, hyphenated)
const PSA_SETS: { code: string; setCode: string; psaSetId: number; alsoCheckSetCodes?: string[] }[] = [
  { code: 'OP01',  setCode: 'op-01',     psaSetId: 224322 },
  { code: 'OP02',  setCode: 'op-02',     psaSetId: 233905 },
  { code: 'OP03',  setCode: 'op-03',     psaSetId: 242625 },
  { code: 'OP04',  setCode: 'op-04',     psaSetId: 249021 },
  { code: 'OP05',  setCode: 'op-05',     psaSetId: 256095 },
  { code: 'OP06',  setCode: 'op-06',     psaSetId: 263953 },
  { code: 'OP07',  setCode: 'op-07',     psaSetId: 274048 },
  { code: 'OP08',  setCode: 'op-08',     psaSetId: 280554 },
  { code: 'OP09',  setCode: 'op-09',     psaSetId: 288478 },
  { code: 'OP10',  setCode: 'op-10',     psaSetId: 298200 },
  { code: 'OP11',  setCode: 'op-11',     psaSetId: 304942 },
  { code: 'OP12',  setCode: 'op-12',     psaSetId: 314057 },
  { code: 'OP13',  setCode: 'op-13',     psaSetId: 321523 },
  { code: 'OP14',  setCode: 'op14-eb04', psaSetId: 327430, alsoCheckSetCodes: ['EB04'] },
  { code: 'OP15',  setCode: 'op15-eb04', psaSetId: 335640, alsoCheckSetCodes: ['EB04'] },
  { code: 'EB01',  setCode: 'eb-01',     psaSetId: 269483 },
  { code: 'EB02',  setCode: 'eb-02',     psaSetId: 302771 },
  { code: 'EB03',  setCode: 'eb-03',     psaSetId: 331864 },
  { code: 'PRB01', setCode: 'prb-01',    psaSetId: 284770 },
  { code: 'PRB02', setCode: 'prb-02',    psaSetId: 318867 },
];

// PSA's category ID for "One Piece TCG". Same for every OP set; if we
// ever add Pokemon / MTG / etc. this becomes a per-set field.
const OP_CATEGORY_ID = 156940;

// Shape of one row in the /Pop/GetSetItems response. PSA includes lots of
// half-grade and qualified-grade fields (Grade7_5, Grade9Q, etc.); we
// declare only the ones we actually persist.
interface PSASpec {
  SpecID: number;
  SubjectName: string;
  Variety: string | null;
  CardNumber: string | null;
  Grade7: number;
  Grade8: number;
  Grade9: number;
  Grade10: number;
  Total: number;
}

interface PSASetItemsResponse {
  draw: number;
  recordsTotal: number;
  recordsFiltered: number;
  data: PSASpec[];
}

// Map of pops_psa grade columns ← PSA response keys. PSA 8.5 and below
// 7 are commercially noise for TCG so we don't persist those.
const GRADE_COLUMNS: { dbCol: string; popKey: keyof PSASpec }[] = [
  { dbCol: 'grade_10', popKey: 'Grade10' },
  { dbCol: 'grade_9',  popKey: 'Grade9' },
  { dbCol: 'grade_8',  popKey: 'Grade8' },
  { dbCol: 'grade_7',  popKey: 'Grade7' },
];

// One call returns every spec in the set. PSA's first row is always a
// "TOTAL POPULATION" summary (SpecID 0) — strip it before returning.
async function fetchPSASetPop(psaSetId: number): Promise<PSASpec[] | null> {
  const res = await fetch('https://www.psacard.com/Pop/GetSetItems', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'Cookie': PSA_WEB_COOKIE!,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
      'Origin': 'https://www.psacard.com',
      'Referer': 'https://www.psacard.com/pop/',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
    },
    body: `draw=1&start=0&length=10000&search=&headingID=${psaSetId}&categoryID=${OP_CATEGORY_ID}&isPSADNA=false`,
  });

  if (res.status === 403) {
    throw new Error('Cloudflare returned 403 — PSA_WEB_COOKIE is likely stale. Refresh it from your browser and re-run.');
  }
  if (!res.ok) {
    console.error(`set ${psaSetId}: HTTP ${res.status}`);
    return null;
  }

  const json = (await res.json()) as PSASetItemsResponse;
  return json.data.filter(d => Number(d.SpecID) > 0);
}

interface CardEntry {
  card_id: string;
  set_id: string;
  /** Numeric portion of the bandai number: 'OP01-016_p3' → '016'. Used to
   *  match PSA's CardNumber regardless of which set's prefix the card_id
   *  carries (PRB reprints keep their original set's prefix). */
  number: string;
  /** From cards.rarity. Used as a backup signal when the TCGplayer
   *  product name doesn't carry a (TR) / (SP) / (SEC) marker. */
  rarity: string | null;
  /** From cards.art_style. Used as backup when the TCGplayer name
   *  doesn't carry (Manga) / (Wanted Poster). E.g. OP13-119_p4 is a
   *  Wanted Ace with art_style='wanted' but its TCG product is named
   *  "Portgas.D.Ace (119) (Super Alternate Art)" with no Wanted marker. */
  artStyle: string | null;
  /** TCGplayer product name, lowercased. May be empty when the card has
   *  no TCG mapping yet. Used for marker matching and subject name. */
  name: string;
  /** cards.name (Bandai's name). Backup for subject-name narrowing when
   *  the TCG name doesn't carry the character name in a parseable form. */
  cardName: string;
}

// Normalize a subject/product name for cross-DB substring matching.
// Strips dots/apostrophes/quotes (so "Portgas.D.Ace" and "Portgas D. Ace"
// both normalize to "portgas d ace", and PSA's `Eustass "Captain" Kid`
// matches our `Eustass"Captain"Kid`) and collapses whitespace.
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.'`"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Decide which of our card_ids a PSA spec maps to. Returns null when the
// spec doesn't match (or the match would be ambiguous / already claimed).
//
// Strategy: PSA gives us (set_code, CardNumber, Variety, SubjectName).
// We narrow by (set_id, number) first — that's the unambiguous scope.
// Then the variety field tells us which marker to look for in the
// TCGplayer product name; the subject name is a final tiebreaker when
// the same set has multiple cards at the same number (e.g. PRB sets
// reprint OP01-016 alongside OP02-016 in the same prb-01 set).
function autoMatchSpec(
  setCode: string,
  alsoCheckSetCodes: string[] | undefined,
  spec: PSASpec,
  bySetAndNumber: Map<string, CardEntry[]>,
  byCardNumber: Map<string, CardEntry[]>,
  claimed: Set<string>,
): string | null {
  if (!spec.CardNumber) return null;
  const paddedNum = spec.CardNumber.padStart(3, '0');
  const variety = (spec.Variety ?? '').trim();
  const subj = normalizeName(spec.SubjectName);

  // Variety → tcg name marker we expect on the matching card. Empty
  // string means base card (no marker should be present).
  // PSA's "Holofoil" is their generic name for an alt-art variant —
  // TCGplayer labels the same card "(Alternate Art)". Distinct from
  // "Jolly Roger Foil" which PSA does name explicitly (and that one we
  // skip since we don't sell JRF cards).
  // Compound varieties containing "Gold" (e.g. "3rd Anniversary-Gold",
  // "Crocodile-Gold") all map to TCGplayer's "(Gold)" marker — a foil
  // treatment given to SP cards from anniversary events.
  // Deliberately unhandled:
  //   - "Jolly Roger Foil" / "Sparkle Foil" — PRB foil-only on low-rarity
  //     cards we don't sell.
  //   - "Pre-Release" — variants vary too much across sets.
  //   - Anniversary Tournament / Errata / Demo Deck / etc. — niche promos.
  let marker: string | null = null;
  // Sentinel: any non-base variant accepted, narrowed only by subject name.
  // Used for varieties like "Special" where PSA doesn't tell us which
  // specific variant (could be any alt art / foil / manga). The subject
  // name disambiguates among candidates at the same set+number.
  const ANY_VARIANT = '__any_variant__';
  // Order matters: "Manga" checked first so compound varieties like
  // "Gold Manga Alternate Art" route to the Manga rule (the most
  // specific signal) rather than the generic Gold rule.
  if (variety === '' ) marker = '';
  else if (/manga/i.test(variety)) marker = '(manga)';
  else if (variety === 'Holofoil') marker = '(holofoil)';
  else if (variety === 'Alternate Art') marker = '(alternate art)';
  else if (variety === 'Special Alternate Art') marker = '(sp)';
  else if (variety === 'Treasure Rare') marker = '(tr)';
  else if (variety === 'Wanted Alternate Art') marker = '(wanted poster)';
  else if (variety.includes('Gold')) marker = '(gold)';
  else if (variety === 'Special') marker = ANY_VARIANT;
  if (marker === null) return null;

  // Excluded markers per variety. E.g. when looking for AA, reject Manga
  // / SP / TR because those have different markers — we want the plain
  // AA variant, not a Manga reprint that happens to also be alt art.
  const excludedMarkers: Record<string, string[]> = {
    '(alternate art)': ['(manga)', '(sp)', '(tr)', '(super alternate art)', '(wanted poster)'],
    '(manga)': ['(sp)', '(tr)'],
    '(sp)': ['(manga)', '(tr)'],
    '(tr)': ['(sp)', '(manga)'],
    '(wanted poster)': ['(sp)', '(tr)', '(manga)'],
  };

  // PRB sets reprint existing cards under various foil treatments, so
  // PSA's "no variety" listing for a PRB spec usually points at the
  // Reprint variant (same art as the original print). Track this so we
  // accept (Reprint)-marked TCG names when looking up base specs in PRB.
  const isPrbSet = setCode.startsWith('prb-');

  function nameMatches(c: CardEntry): boolean {
    if (marker === ANY_VARIANT) {
      // Any non-base variant qualifies. Subject name does the narrowing
      // below — that's the only signal we have for these specs.
      return true;
    }
    if (marker === '') {
      // Base card: no variety markers should be present. Exception: PRB
      // sets accept (Reprint) here because there's no truly-unmarked
      // variant in PRB — the Reprint IS the base print for that set.
      const anyMarker = ['(alternate art)', '(parallel)', '(manga)', '(sp)', '(tr)', '(super alternate art)', '(wanted poster)', '(pirate foil)', '(jolly roger foil)', '(textured foil)', '(full art)']
        .some(m => c.name.includes(m));
      if (anyMarker) return false;
      // Also reject Reprint outside PRB — Reprint markers appear only in
      // PRB sets, but be defensive.
      if (!isPrbSet && c.name.includes('(reprint)')) return false;
      return true;
    }
    if (marker === '(alternate art)') {
      // (Parallel) and (Alternate Art) are synonymous — accept either.
      if (!c.name.includes('(alternate art)') && !c.name.includes('(parallel)')) return false;
    } else if (marker === '(sp)' || marker === '(tr)') {
      // SP / TR: TCGplayer naming is inconsistent — sometimes the marker
      // is in the name ("Rebecca (SP)"), sometimes it's a separate column
      // we don't have, sometimes it's just the bandai number suffix
      // ("Zoro-Juurou (ST18-004)"). Trust the cards.rarity column as a
      // backup: if it matches the variety, accept the card even when the
      // TCG name lacks the marker.
      const rarityMatch =
        (marker === '(sp)' && c.rarity === 'SP') ||
        (marker === '(tr)' && c.rarity === 'TR');
      const nameMarker =
        c.name.includes(marker) ||
        (marker === '(sp)' && c.name.includes('(super alternate art)')) ||
        (marker === '(tr)' && c.name.includes('(treasure rare)'));
      if (!rarityMatch && !nameMarker) return false;
    } else if (marker === '(holofoil)') {
      // PSA's "Holofoil" is a generic tag for any premium foil variant.
      // In our DB that corresponds to (Alternate Art) / (Parallel) /
      // (Full Art) / (Textured Foil) / (Manga) — basically anything
      // that's not a plain base / JRF / Reprint / Pirate Foil. Accept
      // any of those new-art-or-foil markers.
      const isPremiumMarker =
        c.name.includes('(alternate art)') || c.name.includes('(parallel)') ||
        c.name.includes('(full art)') || c.name.includes('(textured foil)') ||
        c.name.includes('(manga)') || c.name.includes('(super alternate art)');
      const isExcluded =
        c.name.includes('(jolly roger foil)') || c.name.includes('(pirate foil)') ||
        c.name.includes('(reprint)') || c.name.includes('(sparkle foil)');
      if (!isPremiumMarker || isExcluded) return false;
    } else if (marker === '(manga)' || marker === '(wanted poster)') {
      // Manga / Wanted: art_style is the truth in our DB. TCG name might
      // not carry the marker (e.g. OP13-119_p4 is a Wanted Ace whose
      // mapped product is named "...(Super Alternate Art)" with no
      // Wanted hint). Accept either art_style OR name marker.
      const artStyleMatch =
        (marker === '(manga)' && c.artStyle === 'manga') ||
        (marker === '(wanted poster)' && c.artStyle === 'wanted');
      if (!c.name.includes(marker) && !artStyleMatch) return false;
    } else {
      if (!c.name.includes(marker!)) return false;
    }
    const exclude = excludedMarkers[marker!] ?? [];
    if (exclude.some(m => c.name.includes(m))) return false;
    return true;
  }

  // Try the primary set_code first, then any combo set fallbacks. Each
  // try filters by (set_id, number), then applies the variety marker
  // filter, then narrows by subject name if needed.
  const setIdsToTry = [setCode, ...(alsoCheckSetCodes ?? [])];
  for (const setId of setIdsToTry) {
    const pool = bySetAndNumber.get(`${setId}::${paddedNum}`) ?? [];
    if (pool.length === 0) continue;
    let candidates = pool.filter(nameMatches);
    // Card-id suffix expectation: for base variety the card_id has no
    // _suffix (true base print). PRB sets are the exception — their
    // "base" is the _r* Reprint variant, so allow any suffix there.
    // For non-base varieties (AA / Manga / SP / etc.) always require a
    // _suffix.
    if (marker === '' && !isPrbSet) candidates = candidates.filter(c => !c.card_id.includes('_'));
    else if (marker !== '') candidates = candidates.filter(c => c.card_id.includes('_'));
    // Subject name match is MANDATORY — not just a tiebreaker. Without
    // this gate, the art_style / rarity fallbacks for SP/TR/Wanted/Manga
    // can match cards from a different character. Example: a Luffy
    // Wanted card with art_style='wanted' at OP13-118 could otherwise
    // be assigned to a Gol D. Roger Wanted spec just because both have
    // art_style='wanted' and the same CardNumber.
    candidates = candidates.filter(c =>
      normalizeName(c.name).includes(subj) ||
      normalizeName(c.cardName).includes(subj),
    );
    // "Red" prefix distinguishes Red Manga / Red Super Alt Art variants
    // from their non-Red counterparts. PSA uses "Red Manga Alternate Art"
    // / TCGplayer uses "Red Super Alternate Art" — both contain "red"
    // somewhere in the tag. When PSA spec variety contains Red, narrow
    // candidates to those whose TCG name also contains "red"; conversely
    // if it doesn't, exclude Red variants so they don't poach the slot.
    const varietyHasRed = /\bred\b/i.test(variety);
    candidates = candidates.filter(c => {
      const cardHasRed = /\bred\b/i.test(c.name);
      return varietyHasRed === cardHasRed;
    });
    const unclaimed = candidates.filter(c => !claimed.has(c.card_id));
    if (unclaimed.length === 1) return unclaimed[0].card_id;
  }

  return null;
}

// Keep the legacy SP/TR cross-set lookup as a separate path. Used when
// variety is one of the cross-set kinds (PSA reuses the original print's
// CardNumber for these, regardless of which set the SP/TR was released in)
// — bySetAndNumber lookup may miss them so fall back to scanning every
// card with the matching number portion.
function autoMatchSpecCrossSet(
  spec: PSASpec,
  byCardNumber: Map<string, CardEntry[]>,
  claimed: Set<string>,
): string | null {
  if (!spec.CardNumber) return null;
  const variety = (spec.Variety ?? '').trim();
  const rarityFilter: string | null =
    variety === 'Special Alternate Art' ? 'SP' :
    variety === 'Treasure Rare' ? 'TR' :
    null;
  const marker =
    variety === 'Special Alternate Art' ? '(sp)' :
    variety === 'Treasure Rare' ? '(tr)' :
    variety === 'Wanted Alternate Art' ? '(wanted poster)' :
    null;
  if (!marker) return null;
  const paddedNum = spec.CardNumber.padStart(3, '0');
  const subj = normalizeName(spec.SubjectName);
  const pool = byCardNumber.get(paddedNum) ?? [];
  const candidates = pool.filter(c => {
    if (!c.card_id.includes('_')) return false;
    if (!normalizeName(c.name).includes(subj)) return false;
    // Accept either an explicit marker in the TCG name OR a rarity match
    // from cards.rarity. Handles cases like ST18-004_p1 ("Zoro-Juurou
    // (ST18-004)" with no TR marker, but rarity='TR' in our DB).
    const nameMatch = c.name.includes(marker);
    const rarityMatch = rarityFilter !== null && c.rarity === rarityFilter;
    return nameMatch || rarityMatch;
  });
  const unclaimed = candidates.filter(c => !claimed.has(c.card_id));
  return unclaimed.length === 1 ? unclaimed[0].card_id : null;
}

async function main() {
  const args = process.argv.slice(2);
  // --match-only: skip the PSA fetch entirely. Re-run the matcher against
  // every existing pops_psa row using the current TCG product names, then
  // update card_id in place. Useful when TCG mappings have changed but we
  // don't need fresh pop counts. Implies --rematch (we re-derive every
  // card_id, ignoring whatever's there — otherwise claimedCardIds would
  // pre-claim every existing match and starve the matcher).
  const matchOnly = args.includes('--match-only');
  const rematch = matchOnly || args.includes('--rematch');
  const setCodeArg = args.find(a => !a.startsWith('--'));

  const targets = setCodeArg
    ? PSA_SETS.filter(s => s.code.toUpperCase() === setCodeArg.toUpperCase())
    : PSA_SETS;

  if (targets.length === 0) {
    console.error(setCodeArg
      ? `No PSA_SETS entry for "${setCodeArg}". Add it at the top of psa-pop-fetch.ts.`
      : 'PSA_SETS is empty. Add at least one set at the top of psa-pop-fetch.ts.');
    process.exit(1);
  }

  if (rematch) console.log('--rematch enabled: existing card_id values will be re-derived from current TCGplayer data.\n');

  // Pre-load: every card with its TCGplayer product name, indexed by
  // bandai prefix. We need the name because _p1/_p2 numbering isn't
  // canonical (e.g. OP08-118_p2 is the Manga variant, not _p1) so we
  // pattern-match on "(Parallel)" / "(Manga)" / "(SP)" / "(TR)"
  // substrings instead.
  //
  // Source switched from the deprecated tcgplayer_card_prices.tcgplayer_product_name
  // (column dropped in Migration F) to cards JOIN card_tcgplayer_mapping.
  // Considers ALL cards (including hidden low-rarity standards) — PSA
  // pop data is useful for the full catalog even if the UI hides those
  // cards from the marketplace. Filtering happens downstream at display
  // time via isHiddenCard().
  //
  // Supabase JS caps .select() at 1000 rows by default; cards has more
  // than that, so paginate via .range() to actually load all variants.
  const PAGE = 1000;

  // Pull mappings (card_id → tcgplayer_name) first, then cards. There's
  // no FK declared between the two tables so we can't do this as a single
  // PostgREST join — join in JS instead.
  const mappingByCardId = new Map<string, string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('card_tcgplayer_mapping')
      .select('card_id, tcgplayer_name')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const m of data) {
      mappingByCardId.set(m.card_id as string, (m.tcgplayer_name as string | null) ?? '');
    }
    if (data.length < PAGE) break;
  }

  // Primary index: bandai prefix → cards with that prefix (regardless of
  // set_id). Used for the in-set lookup when PSA's CardNumber matches the
  // card_id directly (e.g. OP01 spec #001 → OP01-001).
  const bandaiFamily = new Map<string, CardEntry[]>();
  // Secondary index: bare CardNumber → all cards with that number portion
  // across every set. Used for cross-set SP/TR lookups and for narrowing
  // by (set_id, number) when the set's prefix doesn't match (PRB sets
  // reprint cards under their original bandai prefix).
  const byCardNumber = new Map<string, CardEntry[]>();
  // set_id + number → cards with that combo. The narrow path: for any
  // PSA spec we know the set_code and the CardNumber, so look up cards
  // by (set_id, number) directly. Avoids guessing at bandai prefixes.
  const bySetAndNumber = new Map<string, CardEntry[]>();
  let totalCards = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('cards')
      .select('id, set_id, rarity, art_style, name')
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const c of data) {
      const id = c.id as string;
      const setId = c.set_id as string;
      const rarity = (c.rarity as string | null) ?? null;
      const artStyle = (c.art_style as string | null) ?? null;
      const cardName = ((c.name as string | null) ?? '').toLowerCase();
      const tcgName = mappingByCardId.get(id) ?? '';
      const bandai = id.split('_')[0];
      const numMatch = bandai.match(/-(\d+)$/);
      const number = numMatch ? numMatch[1] : '';
      const entry: CardEntry = { card_id: id, set_id: setId, number, rarity, artStyle, name: tcgName.toLowerCase(), cardName };

      const familyList = bandaiFamily.get(bandai);
      if (familyList) familyList.push(entry);
      else bandaiFamily.set(bandai, [entry]);

      if (number) {
        const numList = byCardNumber.get(number);
        if (numList) numList.push(entry);
        else byCardNumber.set(number, [entry]);

        const key = `${setId}::${number}`;
        const snList = bySetAndNumber.get(key);
        if (snList) snList.push(entry);
        else bySetAndNumber.set(key, [entry]);
      }
    }
    totalCards += data.length;
    if (data.length < PAGE) break;
  }

  // Pre-load existing pops_psa rows so we know which specs are already
  // mapped and which card_ids are already claimed. Paginate to defeat the
  // Supabase 1000-row default cap (we now have several thousand specs
  // across all sets).
  const existingPops: { spec_id: number; card_id: string | null }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('pops_psa')
      .select('spec_id, card_id')
      .order('spec_id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    existingPops.push(...data);
    if (data.length < PAGE) break;
  }

  // In --rematch mode we deliberately leave existingSpecToCard empty so
  // every spec re-runs auto-match. claimedCardIds is also empty since no
  // pre-existing claims should block fresh assignment.
  const existingSpecToCard = new Map<number, string | null>();
  const claimedCardIds = new Set<string>();
  if (!rematch) {
    for (const p of existingPops) {
      existingSpecToCard.set(Number(p.spec_id), p.card_id);
      if (p.card_id) claimedCardIds.add(p.card_id);
    }
  }

  console.log(`Loaded ${totalCards} cards (${bandaiFamily.size} bandai prefixes), ${existingSpecToCard.size} existing pops_psa rows.\n`);

  const now = new Date().toISOString();

  // --match-only mode: re-derive card_id for every existing pops_psa row
  // without touching PSA. Reconstructs a minimal PSASpec from the stored
  // description + psa_card_number and runs autoMatchSpec. Only the
  // card_id column is rewritten; pop counts stay as last fetched.
  if (matchOnly) {
    console.log('--match-only enabled: skipping PSA fetch, re-deriving card_id from stored specs.\n');
    const psaSetById = new Map<number, typeof PSA_SETS[number]>();
    for (const t of PSA_SETS) psaSetById.set(t.psaSetId, t);

    const allSpecs: { spec_id: number; psa_set_id: number; psa_card_number: string | null; description: string; variety: string | null; source: string | null; card_id: string | null }[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('pops_psa')
        .select('spec_id, psa_set_id, psa_card_number, description, variety, source, card_id')
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      allSpecs.push(...(data as typeof allSpecs));
      if (data.length < PAGE) break;
    }
    // Manual mappings are preserved across rematches — pre-claim their
    // card_ids so the auto-matcher won't try to grab them for other specs.
    let manualCount = 0;
    for (const r of allSpecs) {
      if (r.source === 'manual' && r.card_id) {
        claimedCardIds.add(r.card_id);
        manualCount++;
      }
    }
    console.log(`Re-matching ${allSpecs.length} pops_psa rows (${manualCount} manual entries preserved)...`);

    // Sort by set order in PSA_SETS, then by description so base cards
    // (no variety) get processed before their variants — important
    // because base cards claim a card_id, leaving the variant pool clean.
    // Sets PSA tracks but we haven't configured go at the end.
    const setOrder = new Map<number, number>();
    PSA_SETS.forEach((t, i) => setOrder.set(t.psaSetId, i));
    allSpecs.sort((a, b) => {
      const ao = setOrder.get(a.psa_set_id) ?? 999;
      const bo = setOrder.get(b.psa_set_id) ?? 999;
      if (ao !== bo) return ao - bo;
      return a.description.localeCompare(b.description);
    });

    const updates: { spec_id: number; card_id: string | null }[] = [];
    let matched = 0;
    let unmapped = 0;
    for (const row of allSpecs) {
      // Skip manually-set mappings entirely — admin's pick is the
      // source of truth, don't overwrite or re-derive.
      if (row.source === 'manual') { matched++; continue; }
      const set = psaSetById.get(row.psa_set_id);
      if (!set) { unmapped++; updates.push({ spec_id: row.spec_id, card_id: null }); continue; }
      // Variety comes from the dedicated column (added by migration
      // 20260531). Subject name is everything in description before the
      // trailing "(Variety)" suffix.
      const variety = (row.variety ?? '').trim();
      const subjectName = variety
        ? row.description.replace(new RegExp(`\\s*\\(${variety.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)\\s*$`), '').trim()
        : row.description.trim();
      const spec = {
        SpecID: row.spec_id,
        SubjectName: subjectName,
        Variety: variety || null,
        CardNumber: row.psa_card_number,
        Total: 0,
      } as PSASpec;
      const cardId = autoMatchSpec(set.setCode, undefined, spec, bySetAndNumber, byCardNumber, claimedCardIds)
        ?? autoMatchSpecCrossSet(spec, byCardNumber, claimedCardIds);
      if (cardId) {
        claimedCardIds.add(cardId);
        matched++;
      } else {
        unmapped++;
      }
      updates.push({ spec_id: row.spec_id, card_id: cardId });
    }

    // Batch-update card_id. Chunked to keep payloads small.
    const CHUNK = 100;
    for (let i = 0; i < updates.length; i += CHUNK) {
      const chunk = updates.slice(i, i + CHUNK);
      await Promise.all(chunk.map(u =>
        supabase.from('pops_psa').update({ card_id: u.card_id }).eq('spec_id', u.spec_id),
      ));
    }
    console.log(`\nSpec-centric pass: matched ${matched}, unmapped ${unmapped} (out of ${allSpecs.length}).`);

    // -------------------------------------------------------------------
    // Card-centric second pass. For every card that still has no PSA
    // spec, look at unmapped specs at its (set_code, number) slot.
    // After filtering out varieties we deliberately don't pursue (JRF,
    // Sparkle Foil, Pre-Release, Anniversary/Tournament, etc.) and
    // requiring subject-name overlap, if EXACTLY ONE candidate spec
    // remains, link it. Catches cases the spec-centric pass missed
    // because that pass returns null for unhandled varieties — but from
    // the card side, the disambiguation is obvious once the ignored
    // varieties are filtered out.
    const IGNORED_VARIETIES = new Set([
      'Pre-Release', 'Pre-Release ',
      'Errata',
      'Demo Deck', 'Demo Deck-Errata',
      'Box Topper', 'Box Topper-Errata',
      'Sparkle Foil',
      'Jolly Roger Foil',
      'Release Event',
    ]);
    function specIsIgnored(v: string | null): boolean {
      const trimmed = (v ?? '').trim();
      if (IGNORED_VARIETIES.has(trimmed)) return true;
      if (/Tournament/i.test(trimmed)) return true;
      return false;
    }

    // Index unmapped specs by (set_code, padded_number).
    const specsBySetNum = new Map<string, typeof allSpecs[number][]>();
    for (const r of allSpecs) {
      const finalCardId = updates.find(u => u.spec_id === r.spec_id)?.card_id ?? r.card_id;
      if (finalCardId) continue; // spec already linked after pass 1
      if (specIsIgnored(r.variety)) continue;
      if (!r.psa_card_number) continue;
      const key = `${set_code(r)}::${r.psa_card_number.padStart(3, '0')}`;
      const list = specsBySetNum.get(key);
      if (list) list.push(r);
      else specsBySetNum.set(key, [r]);
    }
    function set_code(r: typeof allSpecs[number]): string {
      const set = psaSetById.get(r.psa_set_id);
      return set?.setCode ?? '';
    }

    // Build a flat array of all card entries from the bandaiFamily index
    // (which the spec-centric pass already populated). Each card_id
    // appears exactly once across all family lists.
    const allCardEntries: CardEntry[] = [];
    const seenCardIds = new Set<string>();
    for (const family of bandaiFamily.values()) {
      for (const c of family) {
        if (seenCardIds.has(c.card_id)) continue;
        seenCardIds.add(c.card_id);
        allCardEntries.push(c);
      }
    }

    // Cards whose TCG product name carries an ignored marker (JRF, Pirate
    // Foil, Sparkle Foil, Reprint) shouldn't get auto-linked to anything —
    // we don't sell them. Skip in the card-centric pass to prevent the
    // matcher from sending a PSA Holofoil/AA spec to the wrong variant
    // just because it happens to be the only non-ignored option.
    const CARD_NAME_EXCLUDE = ['(jolly roger foil)', '(pirate foil)', '(sparkle foil)', '(reprint)'];

    // For each card not yet claimed, see if there's exactly 1 matching spec.
    const cardUpdates: { spec_id: number; card_id: string }[] = [];
    let cardPassMatched = 0;
    for (const c of allCardEntries) {
      if (claimedCardIds.has(c.card_id)) continue;
      if (CARD_NAME_EXCLUDE.some(m => c.name.includes(m))) continue;
      const numMatch = c.card_id.split('_')[0].match(/-(\d+)$/);
      if (!numMatch) continue;
      const key = `${c.set_id}::${numMatch[1]}`;
      const pool = (specsBySetNum.get(key) ?? []).filter(r =>
        !cardUpdates.some(u => u.spec_id === r.spec_id), // not claimed by this pass
      );
      const cardNameNorm = normalizeName(c.cardName);
      // Subject-name filter — required so a Roger Wanted spec doesn't get
      // pinned to a Luffy Wanted card just because they're the only two
      // at the same slot.
      const matches = pool.filter(r => {
        const variety = (r.variety ?? '').trim();
        const escapedV = variety.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const subj = normalizeName(
          variety
            ? r.description.replace(new RegExp(`\\s*\\(${escapedV}\\)\\s*$`), '').trim()
            : r.description.trim(),
        );
        return cardNameNorm.includes(subj) || subj.includes(cardNameNorm);
      });
      if (matches.length === 1) {
        cardUpdates.push({ spec_id: matches[0].spec_id, card_id: c.card_id });
        claimedCardIds.add(c.card_id);
        cardPassMatched++;
      }
    }

    if (cardUpdates.length > 0) {
      for (let i = 0; i < cardUpdates.length; i += CHUNK) {
        const chunk = cardUpdates.slice(i, i + CHUNK);
        await Promise.all(chunk.map(u =>
          supabase.from('pops_psa').update({ card_id: u.card_id }).eq('spec_id', u.spec_id),
        ));
      }
    }
    console.log(`Card-centric pass: matched ${cardPassMatched} additional cards.`);
    return;
  }

  // Sleep between sets to avoid Cloudflare's per-IP burst protection.
  // PSA's normal page load makes ~1 request per minute; firing 20 in a
  // row trips the bot score even with a valid cookie. 3s is plenty.
  const SET_DELAY_MS = 3000;

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (i > 0) await new Promise(r => setTimeout(r, SET_DELAY_MS));
    const specs = await fetchPSASetPop(t.psaSetId);
    if (!specs) continue;

    const popsRows: Record<string, unknown>[] = [];
    let alreadyMapped = 0;
    let autoMatched = 0;
    let unmapped = 0;

    for (const spec of specs) {
      const specId = Number(spec.SpecID);
      let cardId = existingSpecToCard.get(specId) ?? null;

      if (cardId) {
        alreadyMapped++;
      } else {
        const matched = autoMatchSpec(t.setCode, undefined, spec, bySetAndNumber, byCardNumber, claimedCardIds)
          ?? autoMatchSpecCrossSet(spec, byCardNumber, claimedCardIds);
        if (matched) {
          cardId = matched;
          claimedCardIds.add(matched);
          autoMatched++;
        } else {
          unmapped++;
        }
      }

      // Description = clean subject + variety only. We do NOT prepend
      // ${setCode}-${CardNumber} because PSA reuses the original printing's
      // CardNumber for SP/TR/Pre-Release reprints (so an OP08 SP with
      // CardNumber 013 might actually be OP02-013, not OP08-013). The raw
      // CardNumber goes in psa_card_number for reviewers to look up manually.
      const variety = spec.Variety && spec.Variety.trim() !== '' ? ` (${spec.Variety})` : '';
      const description = `${spec.SubjectName}${variety}`.trim();

      const row: Record<string, unknown> = {
        spec_id: specId,
        psa_set_id: t.psaSetId,
        set_code: t.setCode,
        psa_card_number: spec.CardNumber,
        description,
        variety: (spec.Variety ?? '').trim(),
        card_id: cardId,
        total_pop: Number(spec.Total ?? 0),
        synced_at: now,
      };
      for (const g of GRADE_COLUMNS) {
        row[g.dbCol] = Number(spec[g.popKey] ?? 0);
      }
      popsRows.push(row);
    }

    const { error: catErr } = await supabase
      .from('pops_psa')
      .upsert(popsRows, { onConflict: 'spec_id' });
    if (catErr) {
      console.error(`${t.code}: pops_psa upsert error: ${catErr.message}`);
      continue;
    }

    console.log(
      `${t.code}: ${specs.length} specs returned — ${alreadyMapped} already mapped, ` +
      `${autoMatched} auto-matched, ${unmapped} unmapped.`,
    );
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
