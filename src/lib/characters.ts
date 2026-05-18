import { getAllSets } from '@/lib/cards';
import type { Card } from '@/types/card';

export function nameToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\./g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export interface CharacterEntry {
  name: string;
  slug: string;
  cards: Card[];
}

/**
 * Build a character index from all cards, grouping CHARACTER/LEADER cards by slug.
 * Cards with different names that produce the same slug are grouped together.
 */
export function buildCharacterIndex(allCards: Card[]): CharacterEntry[] {
  const characterCards = allCards.filter(
    (c) => c.type === 'CHARACTER' || c.type === 'LEADER'
  );

  const slugMap = new Map<string, { name: string; cards: Card[] }>();
  for (const card of characterCards) {
    const slug = nameToSlug(card.name);
    const existing = slugMap.get(slug);
    if (existing) {
      existing.cards.push(card);
    } else {
      slugMap.set(slug, { name: card.name, cards: [card] });
    }
  }

  return Array.from(slugMap.entries())
    .map(([slug, { name, cards }]) => ({
      name,
      slug,
      cards,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get all unique character slugs for static generation. Queries the cards
 * table (no prices needed); cached per-request via React.cache() in
 * lib/cards.ts.
 */
export async function getAllCharacterSlugs(): Promise<string[]> {
  const sets = await getAllSets();
  const allCards = sets.flatMap((s) => s.cards);
  const characterCards = allCards.filter(
    (c) => c.type === 'CHARACTER' || c.type === 'LEADER'
  );

  const slugs = new Set<string>();
  for (const card of characterCards) {
    slugs.add(nameToSlug(card.name));
  }

  return Array.from(slugs);
}
