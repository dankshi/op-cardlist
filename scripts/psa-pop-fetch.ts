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
const PSA_SETS: { code: string; psaSetId: number; alsoCheckSetCodes?: string[] }[] = [
  { code: 'OP01',  psaSetId: 224322 },
  { code: 'OP02',  psaSetId: 233905 },
  { code: 'OP03',  psaSetId: 242625 },
  { code: 'OP04',  psaSetId: 249021 },
  { code: 'OP05',  psaSetId: 256095 },
  { code: 'OP06',  psaSetId: 263953 },
  { code: 'OP07',  psaSetId: 274048 },
  { code: 'OP08',  psaSetId: 280554 },
  { code: 'OP09',  psaSetId: 288478 },
  { code: 'OP10',  psaSetId: 298200 },
  { code: 'OP11',  psaSetId: 304942 },
  { code: 'OP12',  psaSetId: 314057 },
  { code: 'OP13',  psaSetId: 321523 },
  { code: 'OP14',  psaSetId: 327430, alsoCheckSetCodes: ['EB04'] },
  { code: 'OP15',  psaSetId: 335640, alsoCheckSetCodes: ['EB04'] },
  { code: 'EB01',  psaSetId: 269483 },
  { code: 'EB02',  psaSetId: 302771 },
  { code: 'EB03',  psaSetId: 331864 },
  { code: 'PRB01', psaSetId: 284770 },
  { code: 'PRB02', psaSetId: 318867 },
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

interface CardEntry { card_id: string; name: string }

// Normalize a subject/product name for cross-DB substring matching.
// Strips dots/apostrophes (so "Portgas.D.Ace" and "Portgas D. Ace" both
// normalize to "portgas d ace") and collapses whitespace.
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Decide which of our card_ids a PSA spec maps to. Returns null when the
// spec doesn't match (or the match would be ambiguous / already claimed).
function autoMatchSpec(
  setCode: string,
  alsoCheckSetCodes: string[] | undefined,
  spec: PSASpec,
  bandaiFamily: Map<string, CardEntry[]>,
  byCardNumber: Map<string, CardEntry[]>,
  claimed: Set<string>,
): string | null {
  if (!spec.CardNumber) return null;
  const paddedNum = spec.CardNumber.padStart(3, '0');
  const variety = (spec.Variety ?? '').trim();

  if (variety === '' || variety === 'Alternate Art' || variety === 'Manga Alternate Art') {
    // In-set rules: PSA's CardNumber matches the bandai number for this
    // set. For combo PSA sets (e.g. "OP14 - EB04") we try the primary
    // code first, then any fallback codes — first one to yield exactly
    // one unclaimed candidate wins.
    const setCodesToTry = [setCode, ...(alsoCheckSetCodes ?? [])];
    for (const code of setCodesToTry) {
      const bandai = `${code}-${paddedNum}`;
      const family = bandaiFamily.get(bandai);
      if (!family || family.length === 0) continue;

      let candidates: CardEntry[];
      if (variety === '') {
        candidates = family.filter(c => c.card_id === bandai);
      } else if (variety === 'Alternate Art') {
        // "(Parallel)" and "(Alternate Art)" are synonymous in our data —
        // the same physical card, just labeled inconsistently by
        // TCGplayer over time. We're standardizing on "(Alternate Art)"
        // going forward, so prefer that tag when both exist in a family
        // (rare, transitional state during dedup); fall back to
        // "(Parallel)" when AA isn't present (older sets not yet
        // cleaned up).
        const excluded = (c: CardEntry) =>
          c.name.includes('(super alternate art)') ||
          c.name.includes('(manga)') ||
          c.name.includes('(sp)') ||
          c.name.includes('(tr)');
        const inFamily = (c: CardEntry) => c.card_id.startsWith(`${bandai}_`);
        const altArt = family.filter(c => inFamily(c) && c.name.includes('(alternate art)') && !excluded(c));
        candidates = altArt.length > 0
          ? altArt
          : family.filter(c => inFamily(c) && c.name.includes('(parallel)') && !excluded(c));
      } else {
        candidates = family.filter(c =>
          c.card_id.startsWith(`${bandai}_`) && c.name.includes('(manga)'),
        );
      }

      const unclaimed = candidates.filter(c => !claimed.has(c.card_id));
      if (unclaimed.length === 1) return unclaimed[0].card_id;
    }
    return null;
  }

  if (variety === 'Special Alternate Art' || variety === 'Treasure Rare') {
    // Cross-set: PSA reuses the original print's CardNumber, so search
    // every card in our DB whose bandai number matches, then narrow by
    // normalized subject name + variant marker.
    const marker = variety === 'Special Alternate Art' ? '(sp)' : '(tr)';
    const subj = normalizeName(spec.SubjectName);
    const pool = byCardNumber.get(paddedNum) ?? [];
    const candidates = pool.filter(c =>
      c.card_id.includes('_') &&
      c.name.includes(marker) &&
      normalizeName(c.name).includes(subj),
    );
    const unclaimed = candidates.filter(c => !claimed.has(c.card_id));
    return unclaimed.length === 1 ? unclaimed[0].card_id : null;
  }

  // Pre-Release, Don!! Card, anything else — leave for manual review.
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const rematch = args.includes('--rematch');
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

  // Pre-load: every card_id + tcgplayer_product_name, indexed by bandai
  // prefix. We need the name because _p1/_p2 numbering isn't canonical
  // (e.g. OP08-118_p2 is the Manga variant, not _p1) so we pattern-match
  // on "(Parallel)" / "(Manga)" / "(SP)" / "(TR)" substrings instead.
  //
  // Supabase JS caps .select() at 1000 rows by default; card_prices has
  // more than that, so paginate via .range() to actually load all variants.
  const bandaiFamily = new Map<string, CardEntry[]>();
  // Secondary index keyed by the bare CardNumber suffix (e.g. "013")
  // for cross-set SP / TR lookups where PSA reuses the original print's
  // CardNumber instead of the current set's slot.
  const byCardNumber = new Map<string, CardEntry[]>();
  const PAGE = 1000;
  let totalCards = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('card_prices')
      .select('card_id, tcgplayer_product_name')
      .order('card_id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const c of data) {
      const bandai = c.card_id.split('_')[0];
      const entry: CardEntry = { card_id: c.card_id, name: (c.tcgplayer_product_name ?? '').toLowerCase() };
      const list = bandaiFamily.get(bandai);
      if (list) list.push(entry);
      else bandaiFamily.set(bandai, [entry]);

      const numMatch = bandai.match(/-(\d+)$/);
      if (numMatch) {
        const num = numMatch[1];
        const numList = byCardNumber.get(num);
        if (numList) numList.push(entry);
        else byCardNumber.set(num, [entry]);
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
        const matched = autoMatchSpec(t.code, t.alsoCheckSetCodes, spec, bandaiFamily, byCardNumber, claimedCardIds);
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
        psa_card_number: spec.CardNumber,
        description,
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
