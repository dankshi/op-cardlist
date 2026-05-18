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

// Test a candidate TCGplayer product against the card's expected variant.
// Returns true if the product is a possible match for this card_id; the
// caller still applies the "exactly one candidate" rule.
function matchesVariant(card: CardRow, product: TcgProductRow): boolean {
  const name = product.product_name.toLowerCase();
  const has = (s: string) => name.includes(s);

  // Rarity gate — when both sides have it, must match. This is the
  // strongest filter and dominates everything else.
  if (card.rarity && product.rarity && card.rarity !== product.rarity) return false;

  // SP cards: bandai marks them rarity='SP'. TCGplayer tags them as "(SP)"
  // or sometimes "(Super Alternate Art)" / "(Red Super Alternate Art)".
  if (card.rarity === 'SP') {
    return has('(sp)') || has('(super alternate art)');
  }
  // Treasure Rare: bandai marks them rarity='TR'. TCGplayer uses "(TR)".
  if (card.rarity === 'TR') {
    return has('(tr)') || has('(treasure rare)');
  }
  // Manga art style: name should have "(Manga)".
  if (card.art_style === 'manga') return has('(manga)');
  // Wanted Poster art style: name should have "(Wanted Poster)".
  if (card.art_style === 'wanted') return has('(wanted poster)');
  // Alternate art: name should have "(Parallel)" or "(Alternate Art)"
  // but NOT carry any of the more-specific variant markers.
  if (card.art_style === 'alternate') {
    const isAA = has('(parallel)') || has('(alternate art)');
    const isSpecial = has('(manga)') || has('(sp)') || has('(tr)') ||
                      has('(super alternate art)') || has('(wanted poster)');
    return isAA && !isSpecial;
  }
  // Standard (base) card: name should have NO variant markers.
  const hasAnyMarker = has('(parallel)') || has('(alternate art)') || has('(manga)') ||
                       has('(sp)') || has('(tr)') || has('(super alternate art)') ||
                       has('(wanted poster)');
  return !hasAnyMarker;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  // 1. Load all cards.
  console.log('Loading cards...');
  const cards = await paginated<CardRow>((from, to) =>
    supabase.from('cards').select('id, set_id, name, rarity, art_style').order('id').range(from, to),
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

  // 3. Load existing card_prices mappings (for conflict detection).
  console.log('Loading existing card_prices mappings...');
  const existing = await paginated<{ card_id: string; tcgplayer_product_id: number | null }>((from, to) =>
    supabase.from('tcgplayer_card_prices').select('card_id, tcgplayer_product_id').not('tcgplayer_product_id', 'is', null).range(from, to),
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

  for (const card of sortedCards) {
    const tcgSetNames = SET_NAME_MAP[card.set_id];
    if (!tcgSetNames || tcgSetNames.length === 0) {
      stats.noSetMap++;
      continue;
    }

    const bandai = bandaiNumber(card.id);
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

    if (unclaimed.length > 1) {
      stats.ambiguous++;
      continue;
    }

    const winner = unclaimed[0];
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
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
