import * as fs from 'fs';
import * as path from 'path';
import type { Card, CardDatabase, CardPrice } from '../src/types/card';

const TCGPLAYER_SEARCH_URL = 'https://mp-search-api.tcgplayer.com/v1/search/request';

interface TCGPlayerProduct {
  productId: number;
  productName: string;
  marketPrice: number | null;
  lowPrice: number | null;
  midPrice: number | null;
  highPrice: number | null;
  productUrlName: string;
  customAttributes: {
    number?: string;
  };
}

interface TCGPlayerSearchResult {
  results: Array<{
    results: TCGPlayerProduct[];
  }>;
}

function isAlternateArt(productName: string): boolean {
  const lower = productName.toLowerCase();
  return lower.includes('alternate art') ||
         lower.includes('(parallel)') ||
         lower.includes('manga') ||
         lower.includes('art variant') ||
         lower.includes('treasure cup') ||
         lower.includes('promo');
}

async function searchTCGPlayer(card: Card): Promise<CardPrice | null> {
  const searchPayload = {
    algorithm: 'sales_exp_fields_boosted',
    from: 0,
    size: 50, // Get more results to find exact match
    filters: {
      term: {
        productLineName: ['one-piece-card-game'],
        productTypeName: ['Cards'],
      },
      range: {},
      match: {},
    },
    listingSearch: {
      filters: {
        term: {},
        range: {},
        exclude: { channelExclusion: 0 },
      },
    },
    context: { cart: {}, shippingCountry: 'US' },
    settings: { useFuzzySearch: true, didYouMean: {} },
    sort: {},
  };

  try {
    // Search by card name + ID for best results
    const searchQuery = `${card.name} ${card.baseId}`;
    const url = `${TCGPLAYER_SEARCH_URL}?q=${encodeURIComponent(searchQuery)}&isList=false`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: JSON.stringify(searchPayload),
    });

    if (!response.ok) {
      console.error(`HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    const allResults = (data as any).results?.[0]?.results || [];

    // Filter to only cards matching our card number exactly
    const matchingCards = allResults.filter((r: any) => {
      const num = r.customAttributes?.number;
      return num && num.toUpperCase() === card.baseId.toUpperCase();
    });

    if (matchingCards.length === 0) {
      return null;
    }

    let result: TCGPlayerProduct | undefined;

    if (card.isParallel) {
      // For parallel cards, prefer alternate art versions
      result = matchingCards.find((r: TCGPlayerProduct) => isAlternateArt(r.productName));
      // Fall back to first match if no specific alternate art found
      if (!result) result = matchingCards[0];
    } else {
      // For regular cards, prefer NON-alternate art versions
      result = matchingCards.find((r: TCGPlayerProduct) => !isAlternateArt(r.productName));
      // Fall back to first match
      if (!result) result = matchingCards[0];
    }

    if (!result) return null;

    return {
      marketPrice: result.marketPrice,
      lowPrice: result.lowPrice,
      midPrice: result.midPrice,
      highPrice: result.highPrice,
      lastUpdated: new Date().toISOString(),
      tcgplayerUrl: `https://www.tcgplayer.com/product/${result.productId}/${result.productUrlName}`,
      tcgplayerProductId: result.productId,
    };
  } catch (error) {
    return null;
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const dataPath = path.join(process.cwd(), 'data', 'cards.json');

  if (!fs.existsSync(dataPath)) {
    console.error('cards.json not found. Run the card scraper first.');
    process.exit(1);
  }

  const database: CardDatabase = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  const args = process.argv.slice(2);
  const setFilter = args.find(a => a.startsWith('--set='))?.split('=')[1];
  const limitArg = args.find(a => a.startsWith('--limit='))?.split('=')[1];
  const limit = limitArg ? parseInt(limitArg, 10) : Infinity;
  const delayMs = 250; // Rate limit delay

  console.log('Starting TCGPlayer price scrape...');
  if (setFilter) console.log(`Filtering to set: ${setFilter}`);
  if (limit < Infinity) console.log(`Limiting to ${limit} cards`);

  let processed = 0;
  let found = 0;
  let notFound = 0;

  for (const set of database.sets) {
    if (setFilter && set.id !== setFilter) continue;

    console.log(`\nProcessing ${set.name} (${set.cards.length} cards)...`);

    for (const card of set.cards) {
      if (processed >= limit) break;

      const label = card.isParallel ? `${card.id} (parallel)` : card.id;
      process.stdout.write(`  ${label.padEnd(20)} ${card.name.substring(0, 25).padEnd(25)} `);

      const price = await searchTCGPlayer(card);

      if (price) {
        card.price = price;
        const displayPrice = price.marketPrice?.toFixed(2) || price.lowPrice?.toFixed(2) || 'N/A';
        console.log(`$${displayPrice}`);
        found++;
      } else {
        console.log('--');
        notFound++;
      }

      processed++;
      await sleep(delayMs);
    }

    if (processed >= limit) break;
  }

  database.lastUpdated = new Date().toISOString();
  fs.writeFileSync(dataPath, JSON.stringify(database, null, 2));

  console.log(`\n✓ Done!`);
  console.log(`  Processed: ${processed}`);
  console.log(`  Found: ${found}`);
  console.log(`  Not found: ${notFound}`);
  console.log(`  Saved to: ${dataPath}`);
}

main().catch(console.error);
