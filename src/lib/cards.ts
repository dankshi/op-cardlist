import type { Card, CardSet, CardDatabase } from '@/types/card';
import cardsData from '../../data/cards.json';

const database = cardsData as CardDatabase;

export function getAllSets(): CardSet[] {
  return database.sets;
}

export function getSetById(setId: string): CardSet | undefined {
  return database.sets.find(set => set.id === setId);
}

export function getSetBySlug(slug: string): CardSet | undefined {
  // Support both 'op-13' and 'op13' formats
  const normalizedSlug = slug.toLowerCase().replace(/[^a-z0-9]/g, '');
  return database.sets.find(set => {
    const normalizedSetId = set.id.toLowerCase().replace(/[^a-z0-9]/g, '');
    return normalizedSetId === normalizedSlug;
  });
}

export function getAllCards(): Card[] {
  return database.sets.flatMap(set => set.cards);
}

export function getCardById(cardId: string): Card | undefined {
  const normalized = cardId.toUpperCase();
  return getAllCards().find(card => card.id.toUpperCase() === normalized);
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
  const lowercaseQuery = query.toLowerCase();
  return getAllCards().filter(card =>
    card.name.toLowerCase().includes(lowercaseQuery) ||
    card.effect.toLowerCase().includes(lowercaseQuery) ||
    card.traits.some(trait => trait.toLowerCase().includes(lowercaseQuery))
  );
}

export function getLastUpdated(): string {
  return database.lastUpdated;
}
