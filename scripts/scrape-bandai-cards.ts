import * as cheerio from 'cheerio';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import type { Card, CardSet, CardColor, CardType, Rarity, Attribute, ArtStyle } from '../src/types/card';

dotenv.config({ path: '.env.local' });

const BASE_URL_EN = 'https://en.onepiece-cardgame.com';
const BASE_URL_ASIA = 'https://asia-en.onepiece-cardgame.com';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase env vars (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

// Map of set series IDs to their info
// English site sets (569xxx) - scraped directly from en.onepiece-cardgame.com
// Asia site sets (556xxx) - used for EB and PRB sets (released earlier on Asia site)
//
// IMPORTANT: Japanese/Asia sets release earlier than English.
// When a set is available on Asia but not English:
// 1. Set site='asia' to scrape card data from Asia site
// 2. Set englishImages=false to use Asia site images (Japanese)
// 3. Once English images are available, set englishImages=true
//
// To check if English images exist: curl -I https://en.onepiece-cardgame.com/images/cardlist/card/[CARD_ID].png
interface SetInfo {
  id: string;
  name: string;
  releaseDate: string; // YYYY-MM-DD format for sorting
  site?: 'asia';
  englishImages?: boolean; // false = use Asia/Japanese images (for unreleased English sets)
}

// Sets ordered by release date (newest first when scraped)
// Release dates are English release dates
const SETS: Record<string, SetInfo> = {
  // Main Booster Packs (English site)
  '569113': { id: 'op-13', name: 'OP-13 - Carrying On His Will', releaseDate: '2025-11-07' },
  '569112': { id: 'op-12', name: 'OP-12 - Legacy of the Master', releaseDate: '2025-08-22' },
  '569111': { id: 'op-11', name: 'OP-11 - A Fist of Divine Speed', releaseDate: '2025-06-06' },
  '569110': { id: 'op-10', name: 'OP-10 - Royal Blood', releaseDate: '2025-03-21' },
  '569109': { id: 'op-09', name: 'OP-09 - Emperors in the New World', releaseDate: '2024-12-13' },
  '569108': { id: 'op-08', name: 'OP-08 - Two Legends', releaseDate: '2024-09-13' },
  '569107': { id: 'op-07', name: 'OP-07 - 500 Years in the Future', releaseDate: '2024-06-28' },
  '569106': { id: 'op-06', name: 'OP-06 - Wings of the Captain', releaseDate: '2024-03-15' },
  '569105': { id: 'op-05', name: 'OP-05 - Awakening of the New Era', releaseDate: '2023-12-08' },
  '569104': { id: 'op-04', name: 'OP-04 - Kingdoms of Intrigue', releaseDate: '2023-09-22' },
  '569103': { id: 'op-03', name: 'OP-03 - Pillars of Strength', releaseDate: '2023-06-30' },
  '569102': { id: 'op-02', name: 'OP-02 - Paramount War', releaseDate: '2023-03-10' },
  '569101': { id: 'op-01', name: 'OP-01 - Romance Dawn', releaseDate: '2022-12-02' },
  // Extra Booster Packs (now available on English site)
  // Previously used Asia site (556xxx) IDs - switched to English site (569xxx) for native English images.
  '569201': { id: 'eb-01', name: 'EB-01 - Memorial Collection', releaseDate: '2024-01-27' },
  '569202': { id: 'eb-02', name: 'EB-02 - Anime 25th Collection', releaseDate: '2024-10-25' },
  '569203': { id: 'eb-03', name: 'EB-03 - One Piece Heroines Edition', releaseDate: '2026-02-02' },
  // OP14-EB04: English combined OP14 + EB04 into one set with different card numbering.
  // - Asia site (556204): Only EB04-xxx cards (EB04-001 to EB04-061). Japanese images.
  // - English site (569114): OP14-001 to OP14-080 + EB04-011 to EB04-041 + OP12-108.
  //   Asia EB04-001 through EB04-010 were renumbered into OP14-xxx for English.
  //   English images available on en.onepiece-cardgame.com.
  // Previously used '556204' with site:'asia', englishImages:false (Japanese images only).
  '569114': { id: 'op14-eb04', name: 'OP14-EB04 - The Azure Sea\'s Seven', releaseDate: '2026-01-16' },
  // OP15-EB04: same combined-set pattern as OP14. Release date is a best
  // guess based on PSA's pop report year (2026) — correct when known.
  '569115': { id: 'op15-eb04', name: 'OP15-EB04 - Adventure on Kami\'s Island', releaseDate: '2026-04-17' },
  // Premium Booster Packs (now available on English site)
  // Previously used Asia site (556301) - switched to English site (569301) for native English images.
  '569301': { id: 'prb-01', name: 'PRB-01 - One Piece Card The Best', releaseDate: '2024-11-08' },
  '569302': { id: 'prb-02', name: 'PRB-02 - One Piece Card The Best vol.2', releaseDate: '2025-05-30' },
  // Promotion Cards & Other Product Cards (English site)
  // These are ongoing categories, not time-limited sets. Release date is approximate (first cards appeared).
  '569901': { id: 'promo', name: 'Promotion Cards', releaseDate: '2022-12-02' },
  '569801': { id: 'other-product', name: 'Other Product Cards', releaseDate: '2022-12-02' },
};

function parseRarity(text: string): Rarity {
  const rarityMap: Record<string, Rarity> = {
    'L': 'L',
    'SEC': 'SEC',
    'SR': 'SR',
    'R': 'R',
    'UC': 'UC',
    'C': 'C',
    'SP': 'SP',
    'TR': 'TR',
    'P': 'P',
  };
  return rarityMap[text.trim()] || 'C';
}

function parseCardType(text: string): CardType {
  const typeMap: Record<string, CardType> = {
    'LEADER': 'LEADER',
    'CHARACTER': 'CHARACTER',
    'EVENT': 'EVENT',
    'STAGE': 'STAGE',
  };
  return typeMap[text.trim().toUpperCase()] || 'CHARACTER';
}

function parseColors(text: string): CardColor[] {
  const colorMap: Record<string, CardColor> = {
    'red': 'Red',
    'green': 'Green',
    'blue': 'Blue',
    'purple': 'Purple',
    'black': 'Black',
    'yellow': 'Yellow',
  };

  const colors: CardColor[] = [];
  const normalized = text.toLowerCase();

  for (const [key, value] of Object.entries(colorMap)) {
    if (normalized.includes(key)) {
      colors.push(value);
    }
  }

  return colors.length > 0 ? colors : ['Red'];
}

function parseAttribute(text: string): Attribute | null {
  const attrMap: Record<string, Attribute> = {
    'strike': 'Strike',
    'slash': 'Slash',
    'special': 'Special',
    'wisdom': 'Wisdom',
    'ranged': 'Ranged',
  };

  const normalized = text.toLowerCase();
  for (const [key, value] of Object.entries(attrMap)) {
    if (normalized.includes(key)) {
      return value;
    }
  }
  return null;
}

function parseNumber(text: string): number | null {
  const cleaned = text.replace(/[^\d]/g, '');
  if (cleaned === '' || text.includes('-')) return null;
  return parseInt(cleaned, 10);
}

function parseTraits(text: string): string[] {
  return text.split('/').map(t => t.trim()).filter(t => t.length > 0);
}

// Known wanted poster cards (card IDs that are wanted poster art)
const WANTED_CARDS = new Set<string>([
  'OP01-016_p4',
  'OP03-112_p4',
  'OP05-067_p4',
  'OP13-118_p4',
  'OP13-119_p4',
  // Add more as discovered
]);

// Known manga art cards
const MANGA_CARDS = new Set<string>([
  'OP07-051_p2', // Boa Hancock manga parallel
  // Add manga card IDs as discovered
]);

function detectArtStyle(cardId: string, imageUrl: string, variant: string | undefined, isParallel: boolean): ArtStyle {
  if (!isParallel) {
    return 'standard';
  }

  // _r* suffix = Reprint (Premium Booster sets only). It's a re-issue of
  // the base card with the same original artwork — not a new alt art.
  // Bandai uses the suffix to disambiguate the printing, but the art is
  // identical to the base. Only appears in prb-XX sets.
  if (variant && /^r\d+$/i.test(variant)) {
    return 'standard';
  }

  // Check against known wanted poster cards
  if (WANTED_CARDS.has(cardId)) {
    return 'wanted';
  }

  // Check against known manga cards
  if (MANGA_CARDS.has(cardId)) {
    return 'manga';
  }

  const lowerUrl = imageUrl.toLowerCase();

  // URL-based detection as fallback
  if (lowerUrl.includes('_manga') || lowerUrl.includes('manga_')) {
    return 'manga';
  }

  if (lowerUrl.includes('_wanted') || lowerUrl.includes('wanted_')) {
    return 'wanted';
  }

  // Default to alternate art for other parallels
  return 'alternate';
}

async function fetchPage(seriesId: string, baseUrl: string): Promise<string> {
  const url = `${baseUrl}/cardlist/?series=${seriesId}`;
  console.log(`Fetching: ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return response.text();
}

function parseCards(html: string, setId: string, useEnglishImages: boolean): Card[] {
  const $ = cheerio.load(html);
  const cards: Card[] = [];
  const seenIds = new Set<string>();

  $('dl.modalCol').each((_, element) => {
    const $card = $(element);
    const fullId = $card.attr('id');

    if (!fullId || seenIds.has(fullId)) {
      return;
    }
    seenIds.add(fullId);

    // Check if this is a parallel art version (e.g., OP13-001_p1)
    const isParallel = fullId.includes('_');
    const variant = isParallel ? fullId.split('_')[1] : undefined;
    const baseId = isParallel ? fullId.split('_')[0] : fullId;

    // Parse info line: "OP13-001 | L | LEADER" or "OP13-001 | SP CARD | LEADER"
    const infoText = $card.find('.infoCol').text();
    const infoParts = infoText.split('|').map(s => s.trim());

    const rarityText = (infoParts[1] || '').replace('CARD', '').trim();
    const rarity = parseRarity(rarityText);
    const cardType = parseCardType(infoParts[2] || '');

    // Card name
    const name = $card.find('.cardName').text().trim();

    // Image URL - use English site when available, otherwise Asia (Japanese)
    const imgSrc = $card.find('.frontCol img').attr('data-src') || '';
    const imageBaseUrl = useEnglishImages ? BASE_URL_EN : BASE_URL_ASIA;
    const imageUrl = imgSrc.startsWith('..')
      ? `${imageBaseUrl}${imgSrc.substring(2)}`
      : imgSrc.startsWith('/')
        ? `${imageBaseUrl}${imgSrc}`
        : imgSrc;

    // Stats
    const costText = $card.find('.cost').text().replace('Life', '').replace('Cost', '').trim();
    const powerText = $card.find('.power').text().replace('Power', '').trim();
    const counterText = $card.find('.counter').text().replace('Counter', '').trim();

    const cost = cardType === 'LEADER' ? null : parseNumber(costText);
    const life = cardType === 'LEADER' ? parseNumber(costText) : null;
    const power = parseNumber(powerText);
    const counter = parseNumber(counterText);

    // Attribute
    const attrText = $card.find('.attribute i').text().trim() ||
                     $card.find('.attribute').text().replace('Attribute', '').trim();
    const attribute = parseAttribute(attrText);

    // Colors
    const colorText = $card.find('.color').text().replace('Color', '').trim();
    const colors = parseColors(colorText);

    // Traits
    const traitsText = $card.find('.feature').text().replace('Type', '').trim();
    const traits = parseTraits(traitsText);

    // Effect
    const effectText = $card.find('.text').clone().children('h3').remove().end().text().trim();

    // Check for trigger effect
    const fullText = $card.find('.text').text();
    const triggerMatch = fullText.match(/\[Trigger\]([^[]*)/i);
    const trigger = triggerMatch ? triggerMatch[1].trim() : null;

    // Detect art style
    const artStyle = detectArtStyle(fullId, imageUrl, variant, isParallel);

    const card: Card = {
      id: fullId,
      baseId,
      name,
      type: cardType,
      colors,
      rarity,
      cost,
      power,
      counter,
      life,
      attribute,
      traits,
      effect: effectText,
      trigger,
      imageUrl,
      setId,
      variant,
      isParallel,
      artStyle,
    };

    cards.push(card);
  });

  return cards;
}

async function scrapeSet(seriesId: string): Promise<CardSet | null> {
  const setInfo = SETS[seriesId];
  if (!setInfo) {
    console.error(`Unknown series ID: ${seriesId}`);
    return null;
  }

  // Use Asia site for EB and PRB sets, English site for others
  const baseUrl = setInfo.site === 'asia' ? BASE_URL_ASIA : BASE_URL_EN;

  try {
    const html = await fetchPage(seriesId, baseUrl);
    // Use English images unless explicitly set to false (for unreleased English sets)
    const useEnglishImages = setInfo.englishImages !== false;
    const cards = parseCards(html, setInfo.id, useEnglishImages);

    console.log(`Found ${cards.length} unique cards in ${setInfo.name}`);

    return {
      id: setInfo.id,
      name: setInfo.name,
      seriesId,
      releaseDate: setInfo.releaseDate,
      cardCount: cards.length,
      cards,
    };
  } catch (error) {
    console.error(`Error scraping ${setInfo.name}:`, error);
    return null;
  }
}

// --- DB upsert helpers --------------------------------------------------

interface CardSetRow {
  id: string;
  name: string;
  series_id: string | null;
  release_date: string | null;
  card_count: number | null;
}

interface CardRow {
  id: string;
  base_id: string;
  set_id: string;
  name: string;
  type: string;
  colors: string[];
  rarity: string | null;
  cost: number | null;
  power: number | null;
  counter: number | null;
  life: number | null;
  attribute: string | null;
  traits: string[];
  effect: string | null;
  trigger_text: string | null;
  image_url: string | null;
  variant: string | null;
  is_parallel: boolean;
  art_style: string | null;
}

function setToRow(s: CardSet, seriesId: string): CardSetRow {
  return {
    id: s.id,
    name: s.name,
    series_id: seriesId,
    release_date: s.releaseDate ?? null,
    card_count: s.cardCount ?? null,
  };
}

function cardToRow(c: Card): CardRow {
  return {
    id: c.id,
    base_id: c.baseId ?? c.id,
    set_id: c.setId,
    name: c.name,
    type: c.type,
    colors: c.colors ?? [],
    rarity: c.rarity ?? null,
    cost: c.cost ?? null,
    power: c.power ?? null,
    counter: c.counter ?? null,
    life: c.life ?? null,
    attribute: c.attribute ?? null,
    traits: c.traits ?? [],
    effect: c.effect ?? null,
    trigger_text: c.trigger ?? null,
    image_url: c.imageUrl ?? null,
    variant: c.variant ?? null,
    is_parallel: c.isParallel ?? false,
    art_style: c.artStyle ?? null,
  };
}

async function upsertInChunks<T>(table: string, rows: T[], onConflict: string, chunkSize = 500): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
    if (error) {
      throw new Error(`${table} upsert failed at chunk ${i}: ${error.message}`);
    }
  }
}

// --- main ---------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const seriesIds = args.filter(a => !a.startsWith('--'));
  const targets = seriesIds.length > 0 ? seriesIds : Object.keys(SETS);

  console.log(`Scraping ${targets.length} set(s)...`);

  const sets: { set: CardSet; seriesId: string }[] = [];

  for (const seriesId of targets) {
    const set = await scrapeSet(seriesId);
    if (set) {
      sets.push({ set, seriesId });
    }
    // Small delay between requests so we don't hammer Bandai
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  if (sets.length === 0) {
    console.log('Nothing to upsert (no sets scraped successfully).');
    return;
  }

  const totalCards = sets.reduce((sum, { set }) => sum + set.cardCount, 0);
  console.log(`\nScraped ${sets.length} set(s), ${totalCards} cards total.`);

  // Dedupe cards by id. A small number of cards appear in multiple sets
  // (e.g. promo reprints listed under both "promo" and "other-product");
  // Postgres won't UPSERT two rows with the same conflict key in one batch.
  const cardMap = new Map<string, CardRow>();
  const dupes: string[] = [];
  for (const { set } of sets) {
    for (const c of set.cards) {
      const row = cardToRow(c);
      if (cardMap.has(row.id)) dupes.push(row.id);
      else cardMap.set(row.id, row);
    }
  }
  const setRows: CardSetRow[] = sets.map(({ set, seriesId }) => setToRow(set, seriesId));
  const cardRows: CardRow[] = Array.from(cardMap.values());
  if (dupes.length > 0) {
    console.log(`  (deduped ${dupes.length} cross-set duplicate id(s): ${dupes.slice(0, 5).join(', ')}${dupes.length > 5 ? '...' : ''})`);
  }

  // Reprint protection. Bandai's "collection" pages (PRB, EB, etc.) list
  // reprints of cards from many other sets — if we naively UPSERT, we
  // overwrite each reprinted card's set_id, breaking the original set's
  // listing. Pre-fetch existing card → set_id mappings; for any incoming
  // card that already exists under a DIFFERENT set, skip it. Cards with
  // a matching set_id still get updated (so name/rarity/etc. corrections
  // from Bandai still propagate when re-scraping the original set).
  console.log('Loading existing cards to detect reprints...');
  const existingSetId = new Map<string, string>();
  const PAGE = 1000;
  for (let f = 0; ; f += PAGE) {
    const { data, error } = await supabase.from('cards').select('id, set_id').range(f, f + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) existingSetId.set(r.id, r.set_id);
    if (data.length < PAGE) break;
  }

  const upsertable: CardRow[] = [];
  const reprints: { id: string; existing: string; incoming: string }[] = [];
  for (const row of cardRows) {
    const existing = existingSetId.get(row.id);
    if (existing == null || existing === row.set_id) {
      upsertable.push(row);
    } else {
      reprints.push({ id: row.id, existing, incoming: row.set_id });
    }
  }

  if (reprints.length > 0) {
    console.log(`  (skipped ${reprints.length} reprint(s) already in DB under another set; original set_id preserved)`);
    for (const r of reprints.slice(0, 3)) {
      console.log(`    ${r.id}: kept set_id=${r.existing} (incoming wanted ${r.incoming})`);
    }
    if (reprints.length > 3) console.log(`    ...and ${reprints.length - 3} more`);
  }

  if (dryRun) {
    console.log('(dry-run — no DB writes)');
    return;
  }

  console.log(`Upserting ${setRows.length} card_sets...`);
  await upsertInChunks('card_sets', setRows, 'id');

  console.log(`Upserting ${upsertable.length} cards (${cardRows.length - upsertable.length} reprints skipped)...`);
  await upsertInChunks('cards', upsertable, 'id');

  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
