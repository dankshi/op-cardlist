import { cache } from 'react';
import type { Card, CardSet, CardPrice, SetImagesDatabase, SetImageData, Rarity, CardType, CardColor, Attribute, ArtStyle } from '@/types/card';
import { supabase } from '@/lib/supabase';
import { HIDDEN_RARITIES, isHiddenByFields } from './card-visibility';

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

// Helper to construct a CardPrice from the joined data sources. After the
// 20260535/20260536 consolidation, prices come from THREE places joined
// via card_tcgplayer_mapping:
//   - tcgplayer_current_prices (view): market/lowest/median/total_listings
//   - tcgplayer_products: last_sold_price/date (eBay sales data)
//   - card_tcgplayer_mapping: tcgplayer_product_id/url/name
function buildCardPrice(
  cur: { market_price?: number | null; lowest_price?: number | null; median_price?: number | null; total_listings?: number | null; recorded_date?: string | null } | null,
  prod: { last_sold_price?: number | null; last_sold_date?: string | null } | null,
  mapping: { product_id: number; url: string | null; name: string | null } | null,
): CardPrice {
  return {
    marketPrice: cur?.market_price ?? null,
    lowestPrice: cur?.lowest_price ?? null,
    medianPrice: cur?.median_price ?? null,
    totalListings: cur?.total_listings ?? null,
    lastSoldPrice: prod?.last_sold_price ?? null,
    lastSoldDate: prod?.last_sold_date ?? null,
    lastUpdated: cur?.recorded_date ?? null,
    tcgplayerProductId: mapping?.product_id ?? null,
    tcgplayerUrl: mapping?.url ?? null,
    tcgplayerProductName: mapping?.name ?? null,
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

// Prices are looked up product-side, not card-side: card_tcgplayer_mapping
// gives us product_id → tcgplayer_current_prices (latest history row) for
// market/lowest/median + tcgplayer_products for last_sold_*. This means
// fixing a mapping immediately changes which price a card shows — the old
// denormalized tcgplayer_card_prices table (keyed by card_id) was the root
// cause of stale-price bugs and is gone after migration 20260537.
const fetchPrices = cache(async (): Promise<Record<string, CardPrice>> => {
  if (!supabase) return {};
  const [mappingRows, curRows, prodRows] = await Promise.all([
    paginated<Record<string, unknown>>((from, to) =>
      supabase!.from('card_tcgplayer_mapping')
        .select('card_id, tcgplayer_product_id, tcgplayer_url, tcgplayer_name')
        .range(from, to),
    ),
    paginated<Record<string, unknown>>((from, to) =>
      supabase!.from('tcgplayer_current_prices')
        .select('tcgplayer_product_id, recorded_date, market_price, lowest_price, median_price, total_listings')
        .range(from, to),
    ),
    paginated<Record<string, unknown>>((from, to) =>
      supabase!.from('tcgplayer_products')
        .select('product_id, last_sold_price, last_sold_date')
        .range(from, to),
    ),
  ]);

  // Index current prices and products by product_id for O(1) joins.
  const curByProduct = new Map<number, Record<string, unknown>>();
  for (const c of curRows) curByProduct.set(c.tcgplayer_product_id as number, c);
  const prodByProduct = new Map<number, Record<string, unknown>>();
  for (const p of prodRows) prodByProduct.set(p.product_id as number, p);

  const prices: Record<string, CardPrice> = {};
  for (const m of mappingRows) {
    const cardId = m.card_id as string;
    const productId = m.tcgplayer_product_id as number | null;
    if (productId == null) continue;
    const cur = curByProduct.get(productId) as { market_price: number | null; lowest_price: number | null; median_price: number | null; total_listings: number | null; recorded_date: string | null } | undefined;
    const prod = prodByProduct.get(productId) as { last_sold_price: number | null; last_sold_date: string | null } | undefined;
    prices[cardId] = buildCardPrice(cur ?? null, prod ?? null, {
      product_id: productId,
      url: (m.tcgplayer_url as string) ?? null,
      name: (m.tcgplayer_name as string) ?? null,
    });
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

// Active on-site listings, grouped by card_id. Powers the "X listings
// from $Y" line under the market price on set + search tiles — shown
// only when sellers exist so the tile stays clean for the (currently
// majority) of cards with no inventory. Row count per listing, not per
// unit: one seller posting "3 of this card" = 1 ask. Lowest price is
// the cheapest active ask, the "from $Y" anchor.
export interface ListingsSummary {
  count: number;
  lowestPrice: number;
}

const fetchActiveListingsSummary = cache(async (): Promise<Record<string, ListingsSummary>> => {
  if (!supabase) return {};
  const rows = await paginated<{ card_id: string; price: number }>((from, to) =>
    supabase!.from('listings')
      .select('card_id, price')
      .eq('status', 'active')
      .range(from, to),
  );
  const summary: Record<string, ListingsSummary> = {};
  for (const r of rows) {
    const existing = summary[r.card_id];
    if (existing) {
      existing.count += 1;
      if (r.price < existing.lowestPrice) existing.lowestPrice = r.price;
    } else {
      summary[r.card_id] = { count: 1, lowestPrice: r.price };
    }
  }
  return summary;
});

export async function getActiveListingsSummary(): Promise<Record<string, ListingsSummary>> {
  return fetchActiveListingsSummary();
}

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

// The visibility rule now lives in the dependency-free ./card-visibility module
// so the tsx scraper can share the exact same predicate. Re-exported here so
// every existing `@/lib/cards` import (admin/cards, set pages, search, …) keeps
// working unchanged.
export { HIDDEN_RARITIES, isHiddenByFields };

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
  const results = await getCardsByIds([cardId]);
  return results[0];
}

/** Canonical card-id casing for this app: the part before the underscore
 *  (e.g. "OP11-001") is uppercase, the variant suffix after it (e.g. "_p1",
 *  "_r2") is lowercase. URLs come in mixed case from users typing them or
 *  from linked routes that lower-case the slug, so we always normalize
 *  before hitting the DB instead of relying on case-insensitive matching. */
function normalizeCardId(id: string): string {
  const idx = id.indexOf('_');
  if (idx < 0) return id.toUpperCase();
  return id.slice(0, idx).toUpperCase() + '_' + id.slice(idx + 1).toLowerCase();
}

/** Lightweight variant — returns card metadata only (no TCGplayer prices).
 *  One round-trip instead of two, ~4x faster. Use when callers just need
 *  `name` / `imageUrl` for tiles (e.g. the /mystuff tab grids), where
 *  price data is unused and the extra joins are pure waste. */
export async function getCardsByIdsBasic(cardIds: string[]): Promise<Card[]> {
  if (!supabase || cardIds.length === 0) return [];
  const normalized = Array.from(new Set(cardIds.map(normalizeCardId)));
  const { data: cardRows, error } = await supabase
    .from('cards')
    .select('*')
    .in('id', normalized);
  if (error || !cardRows) {
    if (error) console.error('getCardsByIdsBasic error:', error);
    return [];
  }
  return cardRows.map(row => rowToCard(row as Record<string, unknown>));
}

/** Targeted batch lookup — cards plus their joined prices. Two round-trips
 *  total: (cards + mappings) in parallel, then (prices + products) in
 *  parallel. The old serial pattern (cards → mappings → prices+products)
 *  was three round-trips. */
export async function getCardsByIds(cardIds: string[]): Promise<Card[]> {
  if (!supabase || cardIds.length === 0) return [];
  const normalized = Array.from(new Set(cardIds.map(normalizeCardId)));

  // Round 1: cards and mappings in parallel. Neither depends on the other.
  const [cardRes, mappingRes] = await Promise.all([
    supabase.from('cards').select('*').in('id', normalized),
    supabase.from('card_tcgplayer_mapping')
      .select('card_id, tcgplayer_product_id, tcgplayer_url, tcgplayer_name')
      .in('card_id', normalized),
  ]);

  if (cardRes.error) {
    console.error('getCardsByIds cards error:', cardRes.error);
    return [];
  }
  const cardRows = cardRes.data;
  if (!cardRows || cardRows.length === 0) return [];

  const mappings = mappingRes.data ?? [];
  const productIds = mappings
    .map(m => m.tcgplayer_product_id as number | null)
    .filter((p): p is number => p != null);

  // Round 2: prices + products, keyed by product_id from the mappings.
  const [curRes, prodRes] = productIds.length > 0
    ? await Promise.all([
        supabase.from('tcgplayer_current_prices')
          .select('tcgplayer_product_id, recorded_date, market_price, lowest_price, median_price, total_listings')
          .in('tcgplayer_product_id', productIds),
        supabase.from('tcgplayer_products')
          .select('product_id, last_sold_price, last_sold_date')
          .in('product_id', productIds),
      ])
    : [{ data: [] as Record<string, unknown>[] }, { data: [] as Record<string, unknown>[] }];

  const curByProduct = new Map<number, Record<string, unknown>>();
  for (const c of curRes.data ?? []) curByProduct.set(c.tcgplayer_product_id as number, c);
  const prodByProduct = new Map<number, Record<string, unknown>>();
  for (const p of prodRes.data ?? []) prodByProduct.set(p.product_id as number, p);

  const prices: Record<string, CardPrice> = {};
  for (const m of mappings ?? []) {
    const cardId = m.card_id as string;
    const productId = m.tcgplayer_product_id as number | null;
    if (productId == null) continue;
    const cur = curByProduct.get(productId) as { market_price: number | null; lowest_price: number | null; median_price: number | null; total_listings: number | null; recorded_date: string | null } | undefined;
    const prod = prodByProduct.get(productId) as { last_sold_price: number | null; last_sold_date: string | null } | undefined;
    prices[cardId] = buildCardPrice(cur ?? null, prod ?? null, {
      product_id: productId,
      url: (m.tcgplayer_url as string) ?? null,
      name: (m.tcgplayer_name as string) ?? null,
    });
  }

  return cardRows.map(row => mergePrice(rowToCard(row as Record<string, unknown>), prices));
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
