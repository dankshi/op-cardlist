import { cache } from 'react';
import type { Card, CardSet, CardPrice, SetImagesDatabase, SetImageData, Rarity, CardType, CardColor, Attribute, ArtStyle } from '@/types/card';
import { supabase } from '@/lib/supabase';

// set-images.json stays as a static file — it's a small separate concern
// (booster box images for set-tile rendering) and isn't part of the
// Bandai card catalog we just moved into Postgres.
let setImagesData: SetImagesDatabase | null = null;
try {
  setImagesData = require('../../data/set-images.json');
} catch {
  // file optional
}

// --- Row → app type mappers ---------------------------------------------

function rowToCard(row: Record<string, unknown>): Card {
  const variant = (row.variant as string | null) ?? null;
  return {
    id: row.id as string,
    baseId: row.base_id as string,
    name: row.name as string,
    type: (row.type as CardType) ?? 'CHARACTER',
    colors: (row.colors as CardColor[]) ?? [],
    rarity: (row.rarity as Rarity) ?? 'C',
    cost: (row.cost as number) ?? null,
    power: (row.power as number) ?? null,
    counter: (row.counter as number) ?? null,
    life: (row.life as number) ?? null,
    attribute: (row.attribute as Attribute) ?? null,
    traits: (row.traits as string[]) ?? [],
    effect: (row.effect as string) ?? '',
    trigger: (row.trigger_text as string) ?? null,
    imageUrl: (row.image_url as string) ?? '',
    setId: row.set_id as string,
    variant: variant ?? undefined,
    // Derived from variant — the scraper always sets these in lockstep
    // (variant comes from the part of the ID after '_'). Computing here
    // means we don't need to keep is_parallel in the DB schema.
    isParallel: variant !== null,
    artStyle: (row.art_style as ArtStyle) ?? 'standard',
  };
}

// Note: mapping fields (tcgplayerProductId, tcgplayerUrl, tcgplayerProductName)
// are now sourced from card_tcgplayer_mapping in fetchPrices() below,
// not from the price row. This function returns them as null; fetchPrices
// overlays them from the mapping join.
function rowToCardPrice(row: Record<string, unknown>): CardPrice {
  return {
    marketPrice: (row.market_price as number) ?? null,
    lowestPrice: (row.lowest_price as number) ?? null,
    medianPrice: (row.median_price as number) ?? null,
    totalListings: (row.total_listings as number) ?? null,
    lastSoldPrice: (row.last_sold_price as number) ?? null,
    lastSoldDate: (row.last_sold_date as string) ?? null,
    lastUpdated: (row.updated_at as string) ?? null,
    tcgplayerUrl: null,
    tcgplayerProductId: null,
    tcgplayerProductName: null,
  };
}

// --- Cached DB fetchers (per-request via React.cache()) -----------------

// Paginate around Supabase's 1000-row default cap.
async function paginated<T>(
  fetcher: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  for (let f = 0; ; f += pageSize) {
    const { data, error } = await fetcher(f, f + pageSize - 1);
    if (error) {
      console.error('paginated fetch error:', error);
      return [];
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
  }
  return all;
}

const fetchCardRows = cache(async (): Promise<Card[]> => {
  if (!supabase) return [];
  const rows = await paginated<Record<string, unknown>>((from, to) =>
    supabase!.from('cards').select('*').order('id').range(from, to),
  );
  return rows.map(rowToCard);
});

interface SetMeta {
  id: string;
  name: string;
  seriesId: string;
  releaseDate: string;
  cardCount: number;
}

const fetchSetRows = cache(async (): Promise<SetMeta[]> => {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('card_sets')
    .select('*')
    .order('release_date', { ascending: false });
  if (error) {
    console.error('fetchSetRows error:', error);
    return [];
  }
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    name: row.name as string,
    seriesId: (row.series_id as string) ?? '',
    releaseDate: (row.release_date as string) ?? '',
    cardCount: (row.card_count as number) ?? 0,
  }));
});

// Prices are joined with the new card_tcgplayer_mapping table at read
// time. Once we strip the duplicate mapping cols from card_prices
// (Migration D), this becomes the only source for the TCGplayer link.
// Until then we prefer card_tcgplayer_mapping over the duplicated cols
// on card_prices (same data; the mapping table wins for clarity).
const fetchPrices = cache(async (): Promise<Record<string, CardPrice>> => {
  if (!supabase) return {};
  const [priceRows, mappingRows] = await Promise.all([
    paginated<Record<string, unknown>>((from, to) =>
      supabase!.from('tcgplayer_card_prices').select('*').range(from, to),
    ),
    paginated<Record<string, unknown>>((from, to) =>
      supabase!.from('card_tcgplayer_mapping').select('card_id, tcgplayer_product_id, tcgplayer_url, tcgplayer_name').range(from, to),
    ),
  ]);

  // Index mappings by card_id so we can attach them to each price row.
  const mappingByCard = new Map<string, { product_id: number; url: string | null; name: string | null }>();
  for (const m of mappingRows) {
    mappingByCard.set(m.card_id as string, {
      product_id: (m.tcgplayer_product_id as number) ?? 0,
      url: (m.tcgplayer_url as string) ?? null,
      name: (m.tcgplayer_name as string) ?? null,
    });
  }

  const prices: Record<string, CardPrice> = {};
  for (const row of priceRows) {
    const cardId = row.card_id as string;
    const basePrice = rowToCardPrice(row);
    const mapping = mappingByCard.get(cardId);
    prices[cardId] = mapping
      ? {
          ...basePrice,
          tcgplayerProductId: mapping.product_id,
          tcgplayerUrl: mapping.url,
          tcgplayerProductName: mapping.name,
        }
      : basePrice;
  }

  // Also surface cards that have a mapping but no price row yet (e.g.
  // freshly-mapped via auto-map-tcgplayer.ts but scrape-prices hasn't run).
  for (const [cardId, mapping] of mappingByCard) {
    if (prices[cardId]) continue;
    prices[cardId] = {
      marketPrice: null,
      lowestPrice: null,
      medianPrice: null,
      totalListings: null,
      lastSoldPrice: null,
      lastSoldDate: null,
      lastUpdated: null,
      tcgplayerProductId: mapping.product_id,
      tcgplayerUrl: mapping.url,
      tcgplayerProductName: mapping.name,
    };
  }

  return prices;
});

// Compose: full sets with their cards (no prices merged yet — that's a
// separate step so callers that don't need prices skip the join).
const fetchAllSets = cache(async (): Promise<CardSet[]> => {
  const [cards, setMetas] = await Promise.all([fetchCardRows(), fetchSetRows()]);
  const cardsBySet = new Map<string, Card[]>();
  for (const card of cards) {
    const list = cardsBySet.get(card.setId);
    if (list) list.push(card);
    else cardsBySet.set(card.setId, [card]);
  }
  return setMetas.map(meta => ({
    ...meta,
    cards: cardsBySet.get(meta.id) ?? [],
  }));
});

// "OP-01 - Romance Dawn" → { 'op-01': 'romance dawn' } — used by search.
const fetchSetNameLookup = cache(async (): Promise<Record<string, string>> => {
  const sets = await fetchSetRows();
  const lookup: Record<string, string> = {};
  for (const set of sets) {
    const match = set.name.match(/^[A-Z0-9-]+ - (.+)$/i);
    lookup[set.id] = match ? match[1].toLowerCase() : set.name.toLowerCase();
  }
  return lookup;
});

// --- Helpers ------------------------------------------------------------

function mergePrice(card: Card, prices: Record<string, CardPrice>): Card {
  const price = prices[card.id];
  return price ? { ...card, price } : card;
}

function setWithMergedPrices(set: CardSet, prices: Record<string, CardPrice>): CardSet {
  return { ...set, cards: set.cards.map(c => mergePrice(c, prices)) };
}

// --- Public API ---------------------------------------------------------

export async function getAllSets(): Promise<CardSet[]> {
  return fetchAllSets();
}

export async function getSetById(setId: string): Promise<CardSet | undefined> {
  const sets = await fetchAllSets();
  const set = sets.find(s => s.id === setId);
  if (!set) return undefined;
  const prices = await fetchPrices();
  return setWithMergedPrices(set, prices);
}

export async function getSetBySlug(slug: string): Promise<CardSet | undefined> {
  // Support both 'op-13' and 'op13' forms
  const normalizedSlug = slug.toLowerCase().replace(/[^a-z0-9]/g, '');
  const sets = await fetchAllSets();
  const set = sets.find(s => s.id.toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedSlug);
  if (!set) return undefined;
  const prices = await fetchPrices();
  return setWithMergedPrices(set, prices);
}

/** Base rarities we don't sell standard prints of. Their alt arts, manga
 *  variants, and wanted-poster variants are still sellable — see
 *  `isHiddenCard()`. Higher rarities (SP, TR, SEC) are always shown.
 *  L (Leader) standard prints are hidden too — only their alt art /
 *  parallel versions have collector value. */
export const HIDDEN_RARITIES: Set<string> = new Set(['C', 'UC', 'R', 'P', 'SR', 'L']);

/** Centralized visibility rule. Every surface (set pages, search,
 *  admin/cards, admin/mappings, admin/psa-pops, card "Other Versions")
 *  routes through this so a rule change here propagates everywhere on the
 *  next render.
 *
 *  String-based variant for admin pages that work with raw Supabase rows
 *  (where the columns are `set_id`, `art_style`, etc., not the Card
 *  type's setId / artStyle).
 *
 *  Current rules:
 *  1. Low-rarity standard prints — base C/UC/R/P/SR/L cards with no
 *     variant treatment. Their alt arts / manga / wanted / textured
 *     variants stay visible.
 *  2. PRB-01 Event/Stage cards (every variant) — the foil/Reprint
 *     non-character reprints are noise, not worth listing. */
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

/** Card-type variant — used everywhere the Card model is in hand. */
export function isHiddenCard(card: Card): boolean {
  return isHiddenByFields(card.setId, card.type, card.rarity, card.artStyle ?? null);
}

export async function getAllCards(): Promise<Card[]> {
  const [cards, prices] = await Promise.all([fetchCardRows(), fetchPrices()]);
  return cards.map(card => mergePrice(card, prices));
}

/** All cards excluding low-rarity standard prints — used for browsing,
 *  search, and carousels. Alt arts / manga / wanted variants stay in. */
export async function getBrowsableCards(): Promise<Card[]> {
  const all = await getAllCards();
  return all.filter(card => !isHiddenCard(card));
}

export async function getCardById(cardId: string): Promise<Card | undefined> {
  const normalized = cardId.toUpperCase();
  const [cards, prices] = await Promise.all([fetchCardRows(), fetchPrices()]);
  const card = cards.find(c => c.id.toUpperCase() === normalized);
  if (!card) return undefined;
  return mergePrice(card, prices);
}

export async function getBaseCards(): Promise<Card[]> {
  return (await getAllCards()).filter(card => !card.isParallel);
}

export async function getParallelCards(baseId: string): Promise<Card[]> {
  return (await getAllCards()).filter(card => card.baseId === baseId && card.isParallel);
}

export async function getCardsBySet(setId: string): Promise<Card[]> {
  const set = await getSetById(setId);
  return set?.cards ?? [];
}

// --- Search -------------------------------------------------------------

function tokenMatchesCard(token: string, card: Card, setNameLookup: Record<string, string>): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, 'i');
  const wordRegex = new RegExp(`\\b${escaped}\\b`, 'i');

  return (
    wordRegex.test(card.name) ||
    regex.test(card.id) ||
    regex.test(card.setId) ||
    (setNameLookup[card.setId] ? regex.test(setNameLookup[card.setId]) : false) ||
    card.traits.some(trait => wordRegex.test(trait)) ||
    wordRegex.test(card.effect) ||
    wordRegex.test(card.type) ||
    (card.price?.tcgplayerProductName ? regex.test(card.price.tcgplayerProductName) : false)
  );
}

function tokenMatchesCardName(token: string, card: Card, setNameLookup: Record<string, string>): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, 'i');
  const wordRegex = new RegExp(`\\b${escaped}\\b`, 'i');

  return (
    wordRegex.test(card.name) ||
    regex.test(card.id) ||
    regex.test(card.setId) ||
    (setNameLookup[card.setId] ? regex.test(setNameLookup[card.setId]) : false) ||
    (card.price?.tcgplayerProductName ? regex.test(card.price.tcgplayerProductName) : false)
  );
}

export async function searchCards(query: string, nameOnly = false): Promise<Card[]> {
  const noiseWords = new Set(['one', 'piece', 'card', 'tcg', 'the', 'a', 'of', 'and', 'in', 'from']);
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(t => t.length > 0);
  const meaningful = tokens.filter(t => !noiseWords.has(t));
  const searchTokens = meaningful.length > 0 ? meaningful : tokens;
  if (searchTokens.length === 0) return [];

  const matcher = nameOnly ? tokenMatchesCardName : tokenMatchesCard;
  const [allCards, setNameLookup] = await Promise.all([getAllCards(), fetchSetNameLookup()]);
  return allCards
    .filter(card => !isHiddenCard(card))
    .filter(card => searchTokens.every(token => matcher(token, card, setNameLookup)))
    .sort((a, b) => (b.price?.marketPrice ?? 0) - (a.price?.marketPrice ?? 0));
}

export async function searchSets(query: string): Promise<{ id: string; name: string; shortName: string; cardCount: number }[]> {
  const noiseWords = new Set(['one', 'piece', 'card', 'tcg', 'the', 'a', 'of', 'and', 'in', 'from', 'list', 'price', 'guide', 'cards']);
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(t => t.length > 0);
  const meaningful = tokens.filter(t => !noiseWords.has(t));
  const searchTokens = meaningful.length > 0 ? meaningful : tokens;
  if (searchTokens.length === 0) return [];

  const [sets, setNameLookup] = await Promise.all([fetchSetRows(), fetchSetNameLookup()]);
  return sets
    .filter(set => {
      const idLower = set.id.toLowerCase();
      const idNoHyphen = set.id.replace(/-/g, '').toLowerCase();
      const shortName = (setNameLookup[set.id] || '').toLowerCase();
      const fullNameLower = set.name.toLowerCase();
      return searchTokens.every(token =>
        idLower.includes(token) ||
        idNoHyphen.includes(token) ||
        shortName.includes(token) ||
        fullNameLower.includes(token)
      );
    })
    .map(set => ({
      id: set.id,
      name: set.name,
      shortName: setNameLookup[set.id] || set.name,
      cardCount: set.cardCount,
    }));
}

// --- Set images (still backed by JSON file) -----------------------------

export function getSetImage(setId: string): SetImageData | null {
  if (!setImagesData) return null;
  return setImagesData.sets[setId] || null;
}

export function getAllSetImages(): Record<string, SetImageData> {
  if (!setImagesData) return {};
  return setImagesData.sets;
}

// --- Index entries for search index API / sets page ---------------------

export interface SearchIndexEntry {
  id: string;
  name: string;
  tcgName: string | null;
  setId: string;
  setName: string;
  traits: string;
  imageUrl: string;
  marketPrice: number | null;
  rarity: string;
  type: string;
  colors: string[];
}

export interface SetIndexEntry {
  id: string;
  name: string;
  shortName: string;
  cardCount: number;
  imageUrl: string | null;
}

export async function getSetIndex(): Promise<SetIndexEntry[]> {
  const images = getAllSetImages();
  const [sets, setNameLookup] = await Promise.all([fetchSetRows(), fetchSetNameLookup()]);
  return sets.map(set => ({
    id: set.id,
    name: set.name,
    shortName: setNameLookup[set.id] || set.name,
    cardCount: set.cardCount,
    imageUrl: images[set.id]?.boosterBoxImageUrl || null,
  }));
}

export async function getSearchIndex(): Promise<SearchIndexEntry[]> {
  const [cards, setNameLookup] = await Promise.all([getBrowsableCards(), fetchSetNameLookup()]);
  return cards.map(card => ({
    id: card.id,
    name: card.name,
    tcgName: card.price?.tcgplayerProductName ?? null,
    setId: card.setId,
    setName: setNameLookup[card.setId] || '',
    traits: card.traits.join(' '),
    imageUrl: card.imageUrl,
    marketPrice: card.price?.marketPrice ?? null,
    rarity: card.rarity,
    type: card.type,
    colors: card.colors,
  }));
}
