/**
 * Extract prices from cards.json to a separate prices.json file.
 * Run this once to migrate existing price data.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CardDatabase } from '../src/types/card';

interface PriceEntry {
  marketPrice: number | null;
  lowPrice: number | null;
  midPrice: number | null;
  highPrice: number | null;
  tcgplayerUrl: string | null;
  tcgplayerProductId: number | null;
  lastUpdated: string | null;
}

interface PriceData {
  lastUpdated: string;
  prices: Record<string, PriceEntry>;
}

async function main() {
  const dataDir = path.join(process.cwd(), 'data');
  const cardsPath = path.join(dataDir, 'cards.json');
  const pricesPath = path.join(dataDir, 'prices.json');

  if (!fs.existsSync(cardsPath)) {
    console.error('cards.json not found');
    process.exit(1);
  }

  const database: CardDatabase = JSON.parse(fs.readFileSync(cardsPath, 'utf-8'));

  const priceData: PriceData = {
    lastUpdated: new Date().toISOString(),
    prices: {},
  };

  let extractedCount = 0;

  for (const set of database.sets) {
    for (const card of set.cards) {
      if (card.price) {
        priceData.prices[card.id] = {
          marketPrice: card.price.marketPrice,
          lowPrice: card.price.lowPrice,
          midPrice: card.price.midPrice,
          highPrice: card.price.highPrice,
          tcgplayerUrl: card.price.tcgplayerUrl,
          tcgplayerProductId: card.price.tcgplayerProductId,
          lastUpdated: card.price.lastUpdated,
        };
        extractedCount++;
      }
    }
  }

  fs.writeFileSync(pricesPath, JSON.stringify(priceData, null, 2));

  console.log(`Extracted ${extractedCount} prices to ${pricesPath}`);
}

main().catch(console.error);
