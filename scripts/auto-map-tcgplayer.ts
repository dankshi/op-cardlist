// Auto-match bandai card_ids to TCGplayer product_ids.
//
// Inputs:
//   cards                  — Bandai card catalog (with rarity + art_style)
//   tcgplayer_products     — TCGplayer's product catalog (with rarity, card_number, name)
//   SET_NAME_MAP           — bandai set_id ↔ TCGplayer set_name slugs (src/lib/set-names.ts)
//   card_prices            — existing mappings (for conflict detection)
//
// Output: writes to card_tcgplayer_mapping with one of three sources:
//   'auto'   — clean unambiguous match, safe to use
//   'review' — auto-match found a different product than the existing
//              card_prices mapping; needs human confirmation
//   (skipped) — ambiguous (multiple candidates) or no candidate; left in
//              the unmapped bucket for /admin/mappings to surface
//
// Matching logic per card (mirrors the PSA spec matcher in
// psa-pop-fetch.ts):
//   1. Find TCGplayer products whose card_number matches the card's
//      bandai prefix (e.g. "OP05-119" for OP05-119_p1) AND whose set_name
//      is one of the slugs SET_NAME_MAP returns for the card's setId.
//   2. Filter by variant tag based on bandai's rarity + art_style:
//        rarity=SP             → name contains "(SP)" or "(Super Alternate Art)"
//        rarity=TR             → name contains "(TR)" or "(Treasure Rare)"
//        art_style=manga       → name contains "(Manga)"
//        art_style=wanted      → name contains "(Wanted Poster)"
//        art_style=alternate   → name has "(Parallel)" or "(Alternate Art)"
//                                 but NOT Manga/SP/TR/Super Alt Art
//        art_style=standard    → no variant markers
//   3. Further filter by TCGplayer's rarity == bandai's rarity when both
//      are present (the strongest disambiguator).
//   4. If exactly one unclaimed candidate → match.
//
// Usage:
//   npx tsx scripts/auto-map-tcgplayer.ts            # full run, writes
//   npx tsx scripts/auto-map-tcgplayer.ts --dry-run  # report only

import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { SET_NAME_MAP } from '../src/lib/set-names';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase env vars');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

interface CardRow {
  id: string;
  set_id: string;
  type: string | null;
  name: string;
  rarity: string | null;
  art_style: string | null;
}

interface TcgProductRow {
  product_id: number;
  product_name: string;
  set_name: string;
  card_number: string | null;
  rarity: string | null;
  product_url_name: string | null;
}

// Paginated fetch helper — defeats Supabase's 1000-row default cap.
async function paginated<T>(
  fetcher: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  for (let f = 0; ; f += pageSize) {
    const { data, error } = await fetcher(f, f + pageSize - 1);
    if (error) throw error as Error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
  }
  return all;
}

// Strip _p1 / _r1 etc. from a card_id to get the bandai card number.
function bandaiNumber(cardId: string): string {
  return cardId.split('_')[0];
}

// Variant ordering for PRB _p* tie-breaking. When a card has multiple
// non-Reprint TCGplayer candidates, the lowest Bandai _p# claims the
// highest-priority variant. Empirically:
//   PRB-02: _p2 → Pirate Foil, _p3 → Alt Art, _p4 → Manga (rare)
//   PRB-01: _p2 → Jolly Roger Foil, _p3 → Alt Art (or Textured Foil)
// Lower priority number = claimed first.
function variantPriority(product: TcgProductRow): number {
  const name = product.product_name.toLowerCase();
  // Foil-treatment variants (same art as base) — claimed by lowest _p#.
  if (name.includes('(pirate foil)')) return 1;
  if (name.includes('(jolly roger foil)')) return 1;
  // New-art variants.
  if (name.includes('(parallel)') || name.includes('(alternate art)')) return 2;
  if (name.includes('(textured foil)')) return 3;
  if (name.includes('(manga)')) return 4;
  if (name.includes('(wanted poster)')) return 5;
  if (name.includes('(sp)') || name.includes('(super alternate art)')) return 6;
  return 99;
}

// Test a candidate TCGplayer product against the card's expected variant.
// Returns true if the product is a possible match for this card_id; the
// caller still applies the "exactly one candidate" rule.
function matchesVariant(card: CardRow, product: TcgProductRow): boolean {
  const name = product.product_name.toLowerCase();
  const has = (s: string) => name.includes(s);

  // PRB (Premium Booster) is hoisted to the top because its products
  // don't follow the normal SP/TR/rarity conventions — a PRB SP card
  // can be labeled (Alternate Art), an SR card can be labeled (Manga),
  // and so on. The _p*/_r* suffix is the truth for these. Standard
  // SP/TR/rarity rules apply to non-PRB cards below.

  // PRB-01: suffix-aligned convention (the _p# number directly
  // determines the variant type, regardless of what other suffixes
  // exist for the card).
  //   _p2 → (Jolly Roger Foil)
  //   _p3 → (Alternate Art) / (Parallel) / (Textured Foil)
  //   _p4+ → manual (Full Art, Gold, and other one-off markers don't
  //          follow a predictable suffix pattern)
  //   _r* → (Reprint)
  if (card.set_id === 'prb-01') {
    const pMatch = card.id.match(/_p(\d+)$/i);
    if (/_r\d+$/i.test(card.id)) return has('(reprint)');
    if (pMatch) {
      const pNum = parseInt(pMatch[1], 10);
      if (pNum === 2) return has('(jolly roger foil)');
      if (pNum === 3) return has('(parallel)') || has('(alternate art)') || has('(textured foil)');
      return false; // _p4+ need manual assignment
    }
    // base card (no suffix) falls through to standard logic below
  }

  // PRB-02 (and any future PRB-XX with similar conventions): positional
  // matching — accept any non-Reprint variant marker, then variantPriority
  // + claim tracking pairs lowest _p# with highest-priority variant.
  if (card.set_id?.startsWith('prb-')) {
    const isPVariant = /_p\d+$/i.test(card.id);
    const isRVariant = /_r\d+$/i.test(card.id);
    if (isRVariant) return has('(reprint)');
    if (isPVariant) {
      const isAcceptedMarker =
        has('(parallel)') || has('(alternate art)') ||
        has('(pirate foil)') || has('(manga)') ||
        has('(sp)') || has('(super alternate art)');
      const isExcluded = has('(reprint)') || has('(full art)') || has('(gold)');
      return isAcceptedMarker && !isExcluded;
    }
    // base card (no suffix) falls through to standard logic below
  }

  // SP / TR rarity is ambiguous on TCGplayer's side:
  //   - In PRB reprint sets (handled above), SP/TR is a *pull-rate* slot
  //     applied to a card whose base rarity is different (e.g. a SR
  //     Rebecca becomes a SP). TCGplayer lists those with the base rarity
  //     in the column and adds a "(SP)" / "(Treasure Rare)" name marker.
  //   - In normal booster sets, SP/TR is the card's actual rarity.
  //     TCGplayer puts SP/TR in the rarity column and adds no marker.
  // Accept either form: rarity-column match OR explicit name marker.
  if (card.rarity === 'SP') {
    return product.rarity === 'SP' || has('(sp)') || has('(super alternate art)');
  }
  if (card.rarity === 'TR') {
    return product.rarity === 'TR' || has('(tr)') || has('(treasure rare)');
  }

  // Rarity gate for non-SP/TR — when both sides have it, must match.
  if (card.rarity && product.rarity && card.rarity !== product.rarity) return false;
  // Manga art style: name should have "(Manga)".
  if (card.art_style === 'manga') return has('(manga)');
  // Wanted Poster art style: name should have "(Wanted Poster)".
  if (card.art_style === 'wanted') return has('(wanted poster)');

  // Standard Alt Art rule (PRB _p*/_r* already handled at top of function).
  // Strictly accepts (Parallel) / (Alternate Art) and rejects (Manga) —
  // manga variants of unknown cards need to be set manually because
  // there's no reliable signal from the Bandai scraper alone.
  if (card.art_style === 'alternate') {
    const isAA = has('(parallel)') || has('(alternate art)');
    const isSpecial = has('(manga)') || has('(sp)') || has('(tr)') ||
                      has('(super alternate art)') || has('(wanted poster)');
    return isAA && !isSpecial;
  }

  // Standard (base) card: name should have NO variant markers.
  const hasAnyMarker = has('(parallel)') || has('(alternate art)') || has('(manga)') ||
                       has('(sp)') || has('(tr)') || has('(super alternate art)') ||
                       has('(wanted poster)') || has('(pirate foil)') || has('(reprint)');
  return !hasAnyMarker;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  // 1. Load all cards.
  console.log('Loading cards...');
  const cards = await paginated<CardRow>((from, to) =>
    supabase.from('cards').select('id, set_id, type, name, rarity, art_style').order('id').range(from, to),
  );
  console.log(`  ${cards.length} cards`);

  // 2. Load all TCGplayer products.
  console.log('Loading tcgplayer_products...');
  const products = await paginated<TcgProductRow>((from, to) =>
    supabase.from('tcgplayer_products').select('product_id, product_name, set_name, card_number, rarity, product_url_name').range(from, to),
  );
  console.log(`  ${products.length} products`);

  // Build indexes:
  //   bySetAndNumber: (set_name, card_number) → list of products in that slot
  //   byProductId: for quick name/url lookup when writing
  const bySetAndNumber = new Map<string, TcgProductRow[]>();
  const byProductId = new Map<number, TcgProductRow>();
  for (const p of products) {
    if (p.card_number) {
      const key = `${p.set_name}::${p.card_number.toUpperCase()}`;
      const list = bySetAndNumber.get(key);
      if (list) list.push(p);
      else bySetAndNumber.set(key, [p]);
    }
    byProductId.set(p.product_id, p);
  }

  // 3. Load existing mappings from card_tcgplayer_mapping (for conflict
  //    detection — if auto-match picks a different product than what's
  //    already there, flag source='review' instead of overwriting silently).
  console.log('Loading existing card_tcgplayer_mapping rows...');
  const existing = await paginated<{ card_id: string; tcgplayer_product_id: number | null }>((from, to) =>
    supabase.from('card_tcgplayer_mapping').select('card_id, tcgplayer_product_id').range(from, to),
  );
  const existingMap = new Map<string, number>();
  for (const e of existing) {
    if (e.tcgplayer_product_id != null) existingMap.set(e.card_id, e.tcgplayer_product_id);
  }
  console.log(`  ${existingMap.size} existing mappings`);

  // 4. Run the matcher.
  console.log('\nMatching...');
  type MappingRow = { card_id: string; tcgplayer_product_id: number; tcgplayer_url: string | null; tcgplayer_name: string | null; source: 'auto' | 'review' };
  const toWrite: MappingRow[] = [];
  const stats = { autoClean: 0, autoConflict: 0, ambiguous: 0, noCandidate: 0, noSetMap: 0, alreadyClaimed: 0 };

  // Track which product_ids we've already assigned this run, so two cards
  // can't both auto-match to the same product.
  const claimedProductIds = new Set<number>();

  // Sort cards so base cards process before variants — base claims its
  // product first, then variants get the remaining options.
  const sortedCards = [...cards].sort((a, b) => {
    const aBase = !a.id.includes('_') ? 0 : 1;
    const bBase = !b.id.includes('_') ? 0 : 1;
    if (aBase !== bBase) return aBase - bBase;
    return a.id.localeCompare(b.id);
  });

  // PRB-01 cards with _p4 or higher suffixes break the standard
  // suffix-aligned rule (_p2=JRF, _p3=AA) — when extra variants exist
  // the conventional mapping shifts (e.g. _p3 might be JRF instead of
  // _p2). Skip auto-matching for the WHOLE card_number in those cases
  // and force manual assignment via the admin UI.
  const prb01SkipNumbers = new Set<string>();
  for (const c of cards) {
    if (c.set_id === 'prb-01' && /_p([4-9]|\d{2,})$/i.test(c.id)) {
      prb01SkipNumbers.add(bandaiNumber(c.id));
    }
  }

  for (const card of sortedCards) {
    const tcgSetNames = SET_NAME_MAP[card.set_id];
    if (!tcgSetNames || tcgSetNames.length === 0) {
      stats.noSetMap++;
      continue;
    }

    const bandai = bandaiNumber(card.id);

    // Skip PRB-01 cards whose card_number has _p4+ siblings — convention
    // is unreliable, leave for manual assignment.
    if (card.set_id === 'prb-01' && prb01SkipNumbers.has(bandai)) {
      stats.ambiguous++;
      continue;
    }
    // Pool: every TCGplayer product in any of this Bandai set's slugs at
    // the right card_number.
    const pool: TcgProductRow[] = [];
    for (const slug of tcgSetNames) {
      const list = bySetAndNumber.get(`${slug}::${bandai}`);
      if (list) pool.push(...list);
    }

    const candidates = pool.filter(p => matchesVariant(card, p));
    const unclaimed = candidates.filter(p => !claimedProductIds.has(p.product_id));

    if (unclaimed.length === 0) {
      if (candidates.length > 0) stats.alreadyClaimed++;
      else stats.noCandidate++;
      continue;
    }

    let winner: TcgProductRow;
    if (unclaimed.length === 1) {
      winner = unclaimed[0];
    } else {
      // Multi-candidate fallback for PRB _p* cards only: TCGplayer lists
      // multiple non-Reprint variants per card_number (Pirate Foil + Alt
      // Art + Manga + etc.) and Bandai uses _p1/_p2/_p3 to distinguish.
      //
      // Convention discovered empirically: the LOWEST _p# claims the
      // highest-priority variant first — (Pirate Foil) for C/UC where it
      // exists, then (Alternate Art) / (Parallel), then (Manga), then
      // others. Sorting by TCGplayer product_id is unreliable (e.g.
      // ST18-001 has AA at a lower product_id than PF, OP07-040 has them
      // reversed). variantPriority + claim tracking + sorted card order
      // gives the right pairing.
      //
      // Non-PRB sets (OP15-EB04 etc.) are intentionally NOT covered here
      // because the matcher's strict alt-art rule rejects (Manga) markers,
      // leaving _p2 manga variants unmatched. Those are set manually since
      // there are only a handful per set.
      const isPRB = card.set_id?.startsWith('prb-') ?? false;
      const isPVariant = /_p\d+$/i.test(card.id);
      if (isPRB && isPVariant) {
        winner = [...unclaimed].sort((a, b) => {
          const pa = variantPriority(a);
          const pb = variantPriority(b);
          if (pa !== pb) return pa - pb;
          return a.product_id - b.product_id;
        })[0];
      } else {
        stats.ambiguous++;
        continue;
      }
    }
    claimedProductIds.add(winner.product_id);

    const prior = existingMap.get(card.id);
    const isConflict = prior != null && prior !== winner.product_id;
    const source: 'auto' | 'review' = isConflict ? 'review' : 'auto';
    if (isConflict) stats.autoConflict++;
    else stats.autoClean++;

    toWrite.push({
      card_id: card.id,
      tcgplayer_product_id: winner.product_id,
      tcgplayer_url: winner.product_url_name ? `https://www.tcgplayer.com/product/${winner.product_id}/${winner.product_url_name}` : null,
      tcgplayer_name: winner.product_name,
      source,
    });
  }

  // 5. Report.
  console.log('\nResults:');
  console.log(`  clean auto-matches:           ${stats.autoClean}`);
  console.log(`  conflicts (review needed):    ${stats.autoConflict}`);
  console.log(`  ambiguous (multiple matches): ${stats.ambiguous}`);
  console.log(`  no candidate found:           ${stats.noCandidate}`);
  console.log(`  product already claimed:      ${stats.alreadyClaimed}`);
  console.log(`  no SET_NAME_MAP entry:        ${stats.noSetMap}`);
  console.log(`  total cards processed:        ${cards.length}`);
  console.log(`  TOTAL to write:               ${toWrite.length}`);

  if (dryRun) {
    console.log('\n(dry-run — no DB writes)');
    if (stats.autoConflict > 0) {
      console.log('\nFirst 10 conflicts (card_id, current → proposed):');
      const conflicts = toWrite.filter(w => w.source === 'review').slice(0, 10);
      for (const c of conflicts) {
        const prior = existingMap.get(c.card_id);
        console.log(`  ${c.card_id.padEnd(15)} ${String(prior).padStart(7)} → ${String(c.tcgplayer_product_id).padStart(7)}  (${c.tcgplayer_name})`);
      }
    }
    return;
  }

  // 6. Upsert in chunks.
  const CHUNK = 500;
  for (let i = 0; i < toWrite.length; i += CHUNK) {
    const chunk = toWrite.slice(i, i + CHUNK);
    const { error } = await supabase.from('card_tcgplayer_mapping').upsert(chunk, { onConflict: 'card_id' });
    if (error) {
      console.error(`Chunk ${i} upsert failed: ${error.message}`);
      process.exit(1);
    }
  }
  console.log(`\nUpserted ${toWrite.length} mappings into card_tcgplayer_mapping.`);

  // 7. Derive art_style from the mapped TCGplayer product name. The
  // product marker is the most reliable signal we have for variant type:
  //   `(Pirate Foil)` / `(Jolly Roger Foil)` / `(Reprint)` → standard
  //                                                  (same art as base)
  //   `(Alternate Art)` / `(Parallel)` / `(Textured Foil)` → alternate
  //                                                  (new artwork)
  //   `(Manga)`                         → manga
  //   `(Wanted Poster)`                 → wanted
  // Anything else (no marker, or markers like (SP) which are rarity
  // labels not art changes) leaves art_style untouched. This is
  // bidirectional — if a card's mapping changes from PF to AA in a
  // re-run, art_style flips accordingly.
  console.log('\nDeriving art_style from product names...');
  const updates: { id: string; art_style: string }[] = [];
  for (const row of toWrite) {
    const name = (row.tcgplayer_name ?? '').toLowerCase();
    let derived: string | null = null;
    if (name.includes('(pirate foil)') || name.includes('(jolly roger foil)') || name.includes('(reprint)')) derived = 'standard';
    else if (name.includes('(manga)')) derived = 'manga';
    else if (name.includes('(wanted poster)')) derived = 'wanted';
    else if (name.includes('(textured foil)')) derived = 'textured';
    else if (name.includes('(parallel)') || name.includes('(alternate art)')) derived = 'alternate';
    if (!derived) continue;
    const card = cards.find(c => c.id === row.card_id);
    if (card && card.art_style !== derived) updates.push({ id: row.card_id, art_style: derived });
  }
  if (updates.length === 0) {
    console.log('  No art_style corrections needed.');
  } else {
    let fixed = 0;
    for (let i = 0; i < updates.length; i += 20) {
      const chunk = updates.slice(i, i + 20);
      const results = await Promise.all(chunk.map(u =>
        supabase.from('cards').update({ art_style: u.art_style }).eq('id', u.id),
      ));
      const fails = results.filter(r => r.error);
      if (fails.length > 0) console.error(`  batch ${i}: ${fails.length} failed; first:`, fails[0].error?.message);
      fixed += chunk.length - fails.length;
    }
    console.log(`  Updated art_style on ${fixed} cards.`);
  }

  // Card-side rule (independent of TCG mapping): in PRB-01, Event-type
  // cards with a _p3 suffix are always the Textured Foil variant. This
  // catches cards that lack a TCG mapping or whose mapped product name
  // doesn't carry the (Textured Foil) marker explicitly.
  console.log('\nApplying card-side rules...');
  const cardRuleUpdates: { id: string; art_style: string }[] = [];
  for (const c of cards) {
    if (
      c.set_id === 'prb-01' &&
      c.type === 'EVENT' &&
      /_p3$/i.test(c.id) &&
      c.art_style !== 'textured'
    ) {
      cardRuleUpdates.push({ id: c.id, art_style: 'textured' });
    }
  }
  if (cardRuleUpdates.length === 0) {
    console.log('  No card-side rule updates needed.');
  } else {
    let ruleFixed = 0;
    for (let i = 0; i < cardRuleUpdates.length; i += 20) {
      const chunk = cardRuleUpdates.slice(i, i + 20);
      const results = await Promise.all(chunk.map(u =>
        supabase.from('cards').update({ art_style: u.art_style }).eq('id', u.id),
      ));
      const fails = results.filter(r => r.error);
      if (fails.length > 0) console.error(`  batch ${i}: ${fails.length} failed; first:`, fails[0].error?.message);
      ruleFixed += chunk.length - fails.length;
    }
    console.log(`  Flipped ${ruleFixed} prb-01 Event _p3 cards to art_style='textured'.`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
