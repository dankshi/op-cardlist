import type { Card, CardSet, CardDatabase, CardPrice, SetImagesDatabase, SetImageData } from '@/types/card';
import cardsData from '../../data/cards.json';

// Try to import separate prices file, fallback to embedded prices
let pricesData: { prices: Record<string, CardPrice> } | null = null;
try {
  pricesData = require('../../data/prices.json');
} catch {
  // prices.json doesn't exist yet, use embedded prices from cards.json
}

// Try to import set images file
let setImagesData: SetImagesDatabase | null = null;
try {
  setImagesData = require('../../data/set-images.json');
} catch {
  // set-images.json doesn't exist yet
}

const database = cardsData as CardDatabase;

// Merge price data with card
function mergePrice(card: Card): Card {
  if (!pricesData) return card; // Use embedded price

  const price = pricesData.prices[card.id];
  if (price) {
    return { ...card, price };
  }
  return card;
}

export function getAllSets(): CardSet[] {
  return database.sets;
}

// Helper to return set with merged prices on cards
function setWithMergedPrices(set: CardSet): CardSet {
  return {
    ...set,
    cards: set.cards.map(mergePrice),
  };
}

export function getSetById(setId: string): CardSet | undefined {
  const set = database.sets.find(set => set.id === setId);
  return set ? setWithMergedPrices(set) : undefined;
}

export function getSetBySlug(slug: string): CardSet | undefined {
  // Support both 'op-13' and 'op13' formats
  const normalizedSlug = slug.toLowerCase().replace(/[^a-z0-9]/g, '');
  const set = database.sets.find(set => {
    const normalizedSetId = set.id.toLowerCase().replace(/[^a-z0-9]/g, '');
    return normalizedSetId === normalizedSlug;
  });
  return set ? setWithMergedPrices(set) : undefined;
}

export function getAllCards(): Card[] {
  return database.sets.flatMap(set => set.cards).map(mergePrice);
}

export function getCardById(cardId: string): Card | undefined {
  const normalized = cardId.toUpperCase();
  const card = database.sets
    .flatMap(set => set.cards)
    .find(card => card.id.toUpperCase() === normalized);
  return card ? mergePrice(card) : undefined;
}

export function getBaseCards(): Card[] {
  return getAllCards().filter(card => !card.isParallel);
}

export function getParallelCards(baseId: string): Card[] {
  return getAllCards().filter(card => card.baseId === baseId && card.isParallel);
}

export function getCardsBySet(setId: string): Card[] {
  const set = getSetById(setId);
  return set?.cards ?? [];
}

export function searchCards(query: string): Card[] {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}\\b`, 'i');
  return getAllCards().filter(card =>
    regex.test(card.name) ||
    card.traits.some(trait => regex.test(trait))
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
  setId: string;
  imageUrl: string;
  marketPrice: number | null;
  rarity: string;
  type: string;
  colors: string[];
}

export function getSearchIndex(): SearchIndexEntry[] {
  return getAllCards().map(card => ({
    id: card.id,
    name: card.name,
    setId: card.setId,
    imageUrl: card.imageUrl,
    marketPrice: card.price?.marketPrice ?? null,
    rarity: card.rarity,
    type: card.type,
    colors: card.colors,
  }));
}
