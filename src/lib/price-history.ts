import fs from 'fs';
import path from 'path';

interface PriceSnapshot {
  date: string;
  cardCount: number;
  prices: Record<string, number>;
}

interface PriceChange {
  cardId: string;
  currentPrice: number;
  previousPrice: number;
  change: number;
  changePercent: number;
}

const PRICE_HISTORY_DIR = path.join(process.cwd(), 'data', 'price-history');

/**
 * Get all available price history files sorted by date (newest first)
 */
export function getPriceHistoryFiles(): string[] {
  try {
    const files = fs.readdirSync(PRICE_HISTORY_DIR);
    return files
      .filter(f => f.endsWith('.json'))
      .sort((a, b) => b.localeCompare(a)); // Newest first
  } catch {
    return [];
  }
}

/**
 * Load a price snapshot by filename
 */
export function loadPriceSnapshot(filename: string): PriceSnapshot | null {
  try {
    const filePath = path.join(PRICE_HISTORY_DIR, filename);
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as PriceSnapshot;
  } catch {
    return null;
  }
}

/**
 * Get price from N days ago for a specific card
 */
export function getPriceFromDaysAgo(cardId: string, daysAgo: number): number | null {
  const files = getPriceHistoryFiles();
  if (files.length <= daysAgo) return null;

  const snapshot = loadPriceSnapshot(files[daysAgo]);
  if (!snapshot) return null;

  return snapshot.prices[cardId] ?? null;
}

/**
 * Calculate price change for a card over N days
 */
export function calculatePriceChange(
  cardId: string,
  currentPrice: number | null,
  daysAgo: number = 7
): PriceChange | null {
  if (currentPrice == null) return null;

  const previousPrice = getPriceFromDaysAgo(cardId, daysAgo);
  if (previousPrice == null) return null;

  const change = currentPrice - previousPrice;
  const changePercent = previousPrice > 0 ? ((change / previousPrice) * 100) : 0;

  return {
    cardId,
    currentPrice,
    previousPrice,
    change,
    changePercent,
  };
}

/**
 * Get top price movers (biggest gainers and losers)
 */
export function getTopPriceMovers(
  currentPrices: Record<string, number>,
  daysAgo: number = 7,
  limit: number = 10
): { gainers: PriceChange[]; losers: PriceChange[] } {
  const files = getPriceHistoryFiles();
  if (files.length <= daysAgo) {
    return { gainers: [], losers: [] };
  }

  const previousSnapshot = loadPriceSnapshot(files[daysAgo]);
  if (!previousSnapshot) {
    return { gainers: [], losers: [] };
  }

  const changes: PriceChange[] = [];

  for (const [cardId, currentPrice] of Object.entries(currentPrices)) {
    const previousPrice = previousSnapshot.prices[cardId];
    if (previousPrice == null || previousPrice === 0) continue;

    const change = currentPrice - previousPrice;
    const changePercent = (change / previousPrice) * 100;

    // Only include significant changes (> 5%)
    if (Math.abs(changePercent) >= 5) {
      changes.push({
        cardId,
        currentPrice,
        previousPrice,
        change,
        changePercent,
      });
    }
  }

  // Sort by percentage change
  const sorted = changes.sort((a, b) => b.changePercent - a.changePercent);

  return {
    gainers: sorted.filter(c => c.changePercent > 0).slice(0, limit),
    losers: sorted.filter(c => c.changePercent < 0).slice(0, limit).reverse(),
  };
}

/**
 * Calculate price changes for all cards in a single batch (reads filesystem ONCE).
 * Returns only significant changes (>= 5%).
 */
export function calculateBatchPriceChanges(
  currentPrices: Record<string, number>,
  daysAgo: number = 7
): Record<string, number> {
  const files = getPriceHistoryFiles();
  if (files.length <= daysAgo) return {};

  const previousSnapshot = loadPriceSnapshot(files[daysAgo]);
  if (!previousSnapshot) return {};

  const changes: Record<string, number> = {};

  for (const [cardId, currentPrice] of Object.entries(currentPrices)) {
    const previousPrice = previousSnapshot.prices[cardId];
    if (previousPrice == null || previousPrice === 0) continue;

    const changePercent =
      ((currentPrice - previousPrice) / previousPrice) * 100;

    if (Math.abs(changePercent) >= 5) {
      changes[cardId] = changePercent;
    }
  }

  return changes;
}

/**
 * Get price history for a specific card (last N days)
 */
export function getCardPriceHistory(
  cardId: string,
  days: number = 30
): { date: string; price: number }[] {
  const files = getPriceHistoryFiles();
  const history: { date: string; price: number }[] = [];

  for (let i = 0; i < Math.min(days, files.length); i++) {
    const snapshot = loadPriceSnapshot(files[i]);
    if (snapshot && snapshot.prices[cardId] != null) {
      history.push({
        date: snapshot.date,
        price: snapshot.prices[cardId],
      });
    }
  }

  // Reverse to show oldest first (for charts)
  return history.reverse();
}
