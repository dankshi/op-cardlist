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

export async function searchCards(query: string): Promise<Card[]> {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}\\b`, 'i');
  return (await getAllCards()).filter(card =>
    regex.test(card.name) ||
    card.traits.some(trait => regex.test(trait)) ||
    (card.price?.tcgplayerProductName && regex.test(card.price.tcgplayerProductName))
  );
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
  imageUrl: string;
  marketPrice: number | null;
  rarity: string;
  type: string;
  colors: string[];
}

export async function getSearchIndex(): Promise<SearchIndexEntry[]> {
  return (await getAllCards()).map(card => ({
    id: card.id,
    name: card.name,
    tcgName: card.price?.tcgplayerProductName ?? null,
    setId: card.setId,
    imageUrl: card.imageUrl,
    marketPrice: card.price?.marketPrice ?? null,
    rarity: card.rarity,
    type: card.type,
    colors: card.colors,
  }));
}
