import type { Card } from '@/types/card';

// Approximate pull rates per booster box (24 packs)
const PULLS_PER_BOX: Record<string, number> = {
  L: 0, // Leaders are in starter decks, not boosters
  C: 144, // 6 per pack
  UC: 72, // 3 per pack
  R: 24, // 1 per pack
  SR: 8, // ~1 per 3 packs
  SEC: 1, // ~1 per box
  SP: 0.25, // Very rare, ~1 per 4 boxes
  P: 0, // Promo, not in boosters
  TR: 0, // Treasure, not regular boosters
};

const DEFAULT_BOX_MSRP = 119.76; // 24 packs x $4.99

export interface BoxEVResult {
  ev: number;
  msrp: number;
  ratio: number;
  verdict: 'worth-opening' | 'break-even' | 'buy-singles';
  verdictLabel: string;
  rarityBreakdown: {
    rarity: string;
    count: number;
    avgPrice: number;
    evContribution: number;
  }[];
}

export function calculateBoxEV(
  cards: Card[],
  msrp?: number
): BoxEVResult {
  const boxMsrp = msrp ?? DEFAULT_BOX_MSRP;

  // Group non-parallel cards by rarity
  const byRarity = new Map<string, Card[]>();
  for (const card of cards) {
    if (card.isParallel) continue;
    const existing = byRarity.get(card.rarity) || [];
    existing.push(card);
    byRarity.set(card.rarity, existing);
  }

  const breakdown: BoxEVResult['rarityBreakdown'] = [];
  let totalEV = 0;

  for (const [rarity, rarityCards] of byRarity.entries()) {
    const pullsPerBox = PULLS_PER_BOX[rarity] ?? 0;
    if (pullsPerBox === 0) continue;

    const pricedCards = rarityCards.filter(
      (c) => c.price?.marketPrice != null && c.price.marketPrice > 0
    );
    if (pricedCards.length === 0) continue;

    const totalRarityValue = pricedCards.reduce(
      (sum, c) => sum + (c.price?.marketPrice ?? 0),
      0
    );
    const avgPrice = totalRarityValue / pricedCards.length;

    // EV = (pulls_per_box / unique_cards) * total_value
    const evContribution =
      (pullsPerBox / rarityCards.length) * totalRarityValue;

    breakdown.push({
      rarity,
      count: rarityCards.length,
      avgPrice,
      evContribution,
    });

    totalEV += evContribution;
  }

  // Parallel card bonus (~3 parallel pulls per box)
  const parallelCards = cards.filter(
    (c) =>
      c.isParallel &&
      c.price?.marketPrice != null &&
      c.price.marketPrice > 0
  );
  if (parallelCards.length > 0) {
    const parallelValue = parallelCards.reduce(
      (sum, c) => sum + (c.price?.marketPrice ?? 0),
      0
    );
    const parallelAvg = parallelValue / parallelCards.length;
    const parallelEV = 3 * parallelAvg;
    totalEV += parallelEV;

    breakdown.push({
      rarity: 'Parallel',
      count: parallelCards.length,
      avgPrice: parallelAvg,
      evContribution: parallelEV,
    });
  }

  // Sort by EV contribution descending
  breakdown.sort((a, b) => b.evContribution - a.evContribution);

  const ratio = boxMsrp > 0 ? totalEV / boxMsrp : 0;

  let verdict: BoxEVResult['verdict'];
  let verdictLabel: string;
  if (ratio >= 1.2) {
    verdict = 'worth-opening';
    verdictLabel = 'Worth Opening';
  } else if (ratio >= 0.85) {
    verdict = 'break-even';
    verdictLabel = 'About Break Even';
  } else {
    verdict = 'buy-singles';
    verdictLabel = 'Buy Singles Instead';
  }

  return {
    ev: totalEV,
    msrp: boxMsrp,
    ratio,
    verdict,
    verdictLabel,
    rarityBreakdown: breakdown,
  };
}
