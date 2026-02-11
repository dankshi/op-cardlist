import { cache } from 'react';
import type { Card, CardSet, CardDatabase, CardPrice, SetImagesDatabase, SetImageData } from '@/types/card';
import { supabase } from '@/lib/supabase';
import cardsData from '../../data/cards.json';

// Try to import set images file
let setImagesData: SetImagesDatabase | null = null;
try {
  setImagesData = require('../../data/set-images.json');
} catch {
  // set-images.json doesn't exist yet
}

const database = cardsData as CardDatabase;

// Map Supabase snake_case row to CardPrice camelCase
function rowToCardPrice(row: any): CardPrice {
  return {
    marketPrice: row.market_price ?? null,
    lowestPrice: row.lowest_price ?? null,
    medianPrice: row.median_price ?? null,
    totalListings: row.total_listings ?? null,
    lastSoldPrice: row.last_sold_price ?? null,
    lastSoldDate: row.last_sold_date ?? null,
    lastUpdated: row.updated_at ?? null,
    tcgplayerUrl: row.tcgplayer_url ?? null,
    tcgplayerProductId: row.tcgplayer_product_id ?? null,
    tcgplayerProductName: row.tcgplayer_product_name ?? null,
  };
}

// Fetch all prices from Supabase, cached per-request via React cache()
const fetchPrices = cache(async (): Promise<Record<string, CardPrice>> => {
  if (!supabase) return {};

  // Supabase limits to 1000 rows by default, use range to get all
  const allRows: any[] = [];
  const PAGE_SIZE = 1000;
  let from = 0;
  let done = false;

  while (!done) {
    const { data, error } = await supabase
      .from('card_prices')
      .select('*')
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error('Error fetching card_prices:', error);
      return {};
    }

    if (data) {
      allRows.push(...data);
    }

    if (!data || data.length < PAGE_SIZE) {
      done = true;
    } else {
      from += PAGE_SIZE;
    }
  }

  const prices: Record<string, CardPrice> = {};
  for (const row of allRows) {
    prices[row.card_id] = rowToCardPrice(row);
  }
  return prices;
});

// Merge price data with card
function mergePrice(card: Card, prices: Record<string, CardPrice>): Card {
  const price = prices[card.id];
  if (price) {
    return { ...card, price };
  }
  return card;
}

// Helper to return set with merged prices on cards
function setWithMergedPrices(set: CardSet, prices: Record<string, CardPrice>): CardSet {
  return {
    ...set,
    cards: set.cards.map(card => mergePrice(card, prices)),
  };
}

export function getAllSets(): CardSet[] {
  return database.sets;
}

export async function getSetById(setId: string): Promise<CardSet | undefined> {
  const set = database.sets.find(set => set.id === setId);
  if (!set) return undefined;
  const prices = await fetchPrices();
  return setWithMergedPrices(set, prices);
}

export async function getSetBySlug(slug: string): Promise<CardSet | undefined> {
  // Support both 'op-13' and 'op13' formats
  const normalizedSlug = slug.toLowerCase().replace(/[^a-z0-9]/g, '');
  const set = database.sets.find(set => {
    const normalizedSetId = set.id.toLowerCase().replace(/[^a-z0-9]/g, '');
    return normalizedSetId === normalizedSlug;
  });
  if (!set) return undefined;
  const prices = await fetchPrices();
  return setWithMergedPrices(set, prices);
}

export async function getAllCards(): Promise<Card[]> {
  const prices = await fetchPrices();
  return database.sets.flatMap(set => set.cards).map(card => mergePrice(card, prices));
}

export async function getCardById(cardId: string): Promise<Card | undefined> {
  const normalized = cardId.toUpperCase();
  const card = database.sets
    .flatMap(set => set.cards)
    .find(card => card.id.toUpperCase() === normalized);
  if (!card) return undefined;
  const prices = await fetchPrices();
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

// Build a set ID → short name lookup for searching by set name
function getSetNameLookup(): Record<string, string> {
  const lookup: Record<string, string> = {};
  for (const set of database.sets) {
    const match = set.name.match(/^[A-Z0-9-]+ - (.+)$/i);
    lookup[set.id] = match ? match[1].toLowerCase() : set.name.toLowerCase();
  }
  return lookup;
}

const setNameLookup = getSetNameLookup();

// Check if a single token matches any field on a card
function tokenMatchesCard(token: string, card: Card): boolean {
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

export async function searchCards(query: string): Promise<Card[]> {
  // Tokenize: split on whitespace, filter out empty/noise tokens
  const noiseWords = new Set(['one', 'piece', 'card', 'tcg', 'the', 'a', 'of', 'and', 'in', 'from']);
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(t => t.length > 0);
  // Keep meaningful tokens; if all are noise, use them anyway
  const meaningful = tokens.filter(t => !noiseWords.has(t));
  const searchTokens = meaningful.length > 0 ? meaningful : tokens;

  if (searchTokens.length === 0) return [];

  const allCards = await getAllCards();
  return allCards
    .filter(card => searchTokens.every(token => tokenMatchesCard(token, card)))
    .sort((a, b) => (b.price?.marketPrice ?? 0) - (a.price?.marketPrice ?? 0));
}

// Search sets by name or ID — returns matching sets for set-level results
export function searchSets(query: string): { id: string; name: string; shortName: string; cardCount: number }[] {
  const noiseWords = new Set(['one', 'piece', 'card', 'tcg', 'the', 'a', 'of', 'and', 'in', 'from', 'list', 'price', 'guide', 'cards']);
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(t => t.length > 0);
  const meaningful = tokens.filter(t => !noiseWords.has(t));
  const searchTokens = meaningful.length > 0 ? meaningful : tokens;

  if (searchTokens.length === 0) return [];

  return database.sets
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

export function getLastUpdated(): string {
  return database.lastUpdated;
}

export function getSetImage(setId: string): SetImageData | null {
  if (!setImagesData) return null;
  return setImagesData.sets[setId] || null;
}

export function getAllSetImages(): Record<string, SetImageData> {
  if (!setImagesData) return {};
  return setImagesData.sets;
}

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

export function getSetIndex(): SetIndexEntry[] {
  const images = getAllSetImages();
  return database.sets.map(set => ({
    id: set.id,
    name: set.name,
    shortName: setNameLookup[set.id] || set.name,
    cardCount: set.cardCount,
    imageUrl: images[set.id]?.boosterBoxImageUrl || null,
  }));
}

export async function getSearchIndex(): Promise<SearchIndexEntry[]> {
  return (await getAllCards()).map(card => ({
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
