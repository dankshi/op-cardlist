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
  setName: string;
  customAttributes: {
    number?: string;
  };
}

// Mapping of our set IDs to TCGPlayer set URL names
// TCGPlayer uses URL-friendly names like "a-fist-of-divine-speed" for OP11
const SET_NAME_MAP: Record<string, string[]> = {
  'op-01': ['romance-dawn', 'romance-dawn-pre-release-cards'],
  'op-02': ['paramount-war', 'paramount-war-pre-release-cards'],
  'op-03': ['pillars-of-strength', 'pillars-of-strength-pre-release-cards'],
  'op-04': ['kingdoms-of-intrigue', 'kingdoms-of-intrigue-pre-release-cards'],
  'op-05': ['awakening-of-the-new-era', 'awakening-of-the-new-era-pre-release-cards', 'awakening-of-the-new-era-1st-anniversary-tournament-cards'],
  'op-06': ['wings-of-the-captain', 'wings-of-the-captain-pre-release-cards'],
  'op-07': ['500-years-in-the-future', '500-years-in-the-future-pre-release-cards'],
  'op-08': ['two-legends', 'two-legends-pre-release-cards'],
  'op-09': ['emperors-in-the-new-world', 'emperors-in-the-new-world-pre-release-cards', 'emperors-in-the-new-world-2nd-anniversary-tournament-cards'],
  'op-10': ['royal-blood', 'royal-blood-pre-release-cards'],
  'op-11': ['a-fist-of-divine-speed', 'a-fist-of-divine-speed-release-event-cards'],
  'op-12': ['legacy-of-the-master', 'legacy-of-the-master-release-event-cards'],
  'op-13': ['carrying-on-his-will', 'carrying-on-his-will-3rd-anniversary-tournament-cards'],
  'eb-01': ['extra-booster-memorial-collection'],
  'eb-02': ['extra-booster-anime-25th-collection'],
  'eb-03': ['extra-booster-one-piece-heroines-edition'],
  'op14-eb04': ['extra-booster-the-azure-seas-seven', 'the-azure-seas-seven', 'the-azure-seas-seven-release-event-cards'],
  'prb-01': ['premium-booster-the-best'],
};

// Internal art style type for more precise matching
type InternalArtStyle = 'standard' | 'alternate' | 'manga' | 'super' | 'red-super' | 'wanted' | 'treasure';

// Categorize TCGPlayer product names into art styles
function getArtStyleFromName(productName: string): InternalArtStyle {
  const lower = productName.toLowerCase();

  if (lower.includes('red super alternate')) return 'red-super';
  if (lower.includes('super alternate') || lower.includes('super alt')) return 'super';
  if (lower.includes('wanted') || lower.includes('wanted poster')) return 'wanted';
  if (lower.includes('manga')) return 'manga';
  if (lower.includes('treasure') || lower.includes('treasure cup') || lower.includes('box topper')) return 'treasure';
  if (lower.includes('alternate art') || lower.includes('alt art') || lower.includes('parallel') || lower.includes('art variant')) return 'alternate';

  return 'standard';
}

// Map our card variants to expected TCGPlayer art styles
function getExpectedArtStyle(card: Card): InternalArtStyle {
  if (!card.isParallel) return 'standard';

  if (card.artStyle === 'manga') return 'manga';
  if (card.artStyle === 'wanted') return 'wanted';

  const variant = card.variant;
  if (variant === 'p1') return 'alternate';
  if (variant === 'p2') return 'super';
  if (variant === 'p3') return 'red-super';
  if (variant === 'p4') return 'wanted';

  return 'alternate';
}

// Fetch all products from TCGPlayer for a specific set
async function fetchSetProducts(setNames: string[], debug: boolean = false): Promise<TCGPlayerProduct[]> {
  const allProducts: TCGPlayerProduct[] = [];
  const seenIds = new Set<number>();

  for (const setName of setNames) {
    let page = 0;
    const pageSize = 50; // TCGPlayer API limits to 50 when filtering by setName
    let hasMore = true;

    while (hasMore) {
      const searchPayload = {
        algorithm: 'sales_exp_fields_boosted',
        from: page * pageSize,
        size: pageSize,
        filters: {
          term: {
            productLineName: ['one-piece-card-game'],
            productTypeName: ['Cards'],
            setName: [setName],
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
        settings: { useFuzzySearch: false, didYouMean: {} },
        sort: {},
      };

      const url = `${TCGPLAYER_SEARCH_URL}?q=&isList=false`;

      try {
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
          if (debug) console.error(`  HTTP ${response.status} for set ${setName}`);
          break;
        }

        const data = await response.json();
        const results: TCGPlayerProduct[] = (data as any).results?.[0]?.results || [];

        if (debug && page === 0) {
          console.log(`  Fetching ${setName}: ${(data as any).results?.[0]?.totalResults || 0} products`);
        }

        for (const product of results) {
          if (!seenIds.has(product.productId)) {
            seenIds.add(product.productId);
            allProducts.push({
              ...product,
              setName: setName,
            });
          }
        }

        hasMore = results.length === pageSize;
        page++;

        // Rate limiting
        await sleep(100);
      } catch (error) {
        if (debug) console.error(`  Error fetching ${setName}:`, error);
        break;
      }
    }
  }

  return allProducts;
}

// Match our card to TCGPlayer products by card number and art style
function findMatchingProduct(card: Card, products: TCGPlayerProduct[], debug: boolean = false): TCGPlayerProduct | null {
  // Filter products by card number
  const matchingProducts = products.filter((p) => {
    const num = p.customAttributes?.number?.toUpperCase() || '';
    const baseIdUpper = card.baseId.toUpperCase();

    // Match full ID (OP13-118) or variations
    return num === baseIdUpper ||
           num.replace(/-/g, '') === baseIdUpper.replace(/-/g, '') ||
           num === card.baseId.match(/-(\d+)$/)?.[1]; // Just the number
  });

  if (matchingProducts.length === 0) {
    if (debug) console.log(`    No products match card number ${card.baseId}`);
    return null;
  }

  if (debug) {
    console.log(`    Found ${matchingProducts.length} matching products for ${card.baseId}:`);
    matchingProducts.forEach((p, i) => {
      console.log(`      ${i + 1}. [${getArtStyleFromName(p.productName)}] ${p.productName} - $${p.marketPrice}`);
    });
  }

  // Get expected art style for this card
  const expectedStyle = getExpectedArtStyle(card);

  // Find best match by art style
  let result: TCGPlayerProduct | undefined;

  if (!card.isParallel) {
    // For base cards, prefer standard (non-alternate) versions
    result = matchingProducts.find((p) => getArtStyleFromName(p.productName) === 'standard');
  } else {
    // For parallel cards, try to match the specific art style
    result = matchingProducts.find((p) => getArtStyleFromName(p.productName) === expectedStyle);

    // Fallbacks for specific styles
    if (!result && expectedStyle === 'red-super') {
      result = matchingProducts.find((p) => ['red-super', 'super', 'alternate'].includes(getArtStyleFromName(p.productName)));
    }
    if (!result && expectedStyle === 'super') {
      result = matchingProducts.find((p) => ['super', 'red-super', 'alternate'].includes(getArtStyleFromName(p.productName)));
    }
    if (!result && expectedStyle === 'wanted') {
      result = matchingProducts.find((p) => ['wanted', 'super', 'alternate'].includes(getArtStyleFromName(p.productName)));
    }
    if (!result && expectedStyle === 'manga') {
      result = matchingProducts.find((p) => ['manga', 'alternate'].includes(getArtStyleFromName(p.productName)));
    }
    if (!result && expectedStyle === 'alternate') {
      result = matchingProducts.find((p) => getArtStyleFromName(p.productName) === 'alternate');
    }

    // Fall back to any non-standard version
    if (!result) {
      result = matchingProducts.find((p) => getArtStyleFromName(p.productName) !== 'standard');
    }
  }

  // Final fallback
  if (!result) {
    result = matchingProducts[0];
  }

  if (debug && result) {
    console.log(`    Selected: ${result.productName}`);
  }

  return result || null;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface PriceData {
  lastUpdated: string;
  prices: Record<string, CardPrice>;
}

async function main() {
  const dataDir = path.join(process.cwd(), 'data');
  const cardsPath = path.join(dataDir, 'cards.json');
  const pricesPath = path.join(dataDir, 'prices.json');

  if (!fs.existsSync(cardsPath)) {
    console.error('cards.json not found. Run the card scraper first.');
    process.exit(1);
  }

  const database: CardDatabase = JSON.parse(fs.readFileSync(cardsPath, 'utf-8'));

  // Load existing prices
  let priceData: PriceData = {
    lastUpdated: new Date().toISOString(),
    prices: {},
  };
  if (fs.existsSync(pricesPath)) {
    priceData = JSON.parse(fs.readFileSync(pricesPath, 'utf-8'));
  }

  const args = process.argv.slice(2);
  const setFilter = args.find(a => a.startsWith('--set='))?.split('=')[1];
  const cardFilter = args.find(a => a.startsWith('--card='))?.split('=')[1];
  const debug = args.includes('--debug');
  const listSets = args.includes('--list-sets');

  if (listSets) {
    console.log('Available sets and their TCGPlayer mappings:');
    for (const set of database.sets) {
      const tcgNames = SET_NAME_MAP[set.id] || ['UNMAPPED'];
      console.log(`  ${set.id.padEnd(10)} -> ${tcgNames.join(', ')}`);
    }
    return;
  }

  // Count total cards to process
  let totalCards = 0;
  for (const set of database.sets) {
    if (setFilter && set.id !== setFilter) continue;
    if (!SET_NAME_MAP[set.id]) continue;
    for (const card of set.cards) {
      if (cardFilter && !card.id.toLowerCase().includes(cardFilter.toLowerCase())) continue;
      totalCards++;
    }
  }

  console.log('Starting TCGPlayer price scrape (set-based)...');
  console.log(`Writing to: ${pricesPath}`);
  console.log(`Total cards to process: ${totalCards}`);
  if (setFilter) console.log(`Filtering to set: ${setFilter}`);
  if (cardFilter) console.log(`Filtering to card: ${cardFilter}`);
  if (debug) console.log('Debug mode enabled');

  let totalProcessed = 0;
  let totalFound = 0;
  let totalNotFound = 0;
  const startTime = Date.now();

  function formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (minutes < 60) return `${minutes}m ${secs}s`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  }

  function getProgressLine(): string {
    const percent = totalCards > 0 ? ((totalProcessed / totalCards) * 100).toFixed(1) : '0.0';
    const elapsed = Date.now() - startTime;
    const rate = totalProcessed > 0 ? elapsed / totalProcessed : 0;
    const remaining = (totalCards - totalProcessed) * rate;
    const eta = totalProcessed > 5 ? formatTime(remaining) : '--';
    return `[${totalProcessed}/${totalCards}] ${percent}% | ETA: ${eta}`;
  }

  for (const set of database.sets) {
    if (setFilter && set.id !== setFilter) continue;

    const tcgSetNames = SET_NAME_MAP[set.id];
    if (!tcgSetNames) {
      console.log(`\nSkipping ${set.name} - no TCGPlayer mapping`);
      continue;
    }

    console.log(`\n${getProgressLine()} | Processing ${set.name}...`);

    // Fetch all products for this set from TCGPlayer
    const products = await fetchSetProducts(tcgSetNames, debug);
    console.log(`  Fetched ${products.length} TCGPlayer products`);

    if (products.length === 0) {
      console.log(`  No products found - check set name mapping`);
      continue;
    }

    // Match each of our cards to TCGPlayer products
    for (const card of set.cards) {
      if (cardFilter && !card.id.toLowerCase().includes(cardFilter.toLowerCase())) {
        continue;
      }

      const label = card.isParallel ? `${card.id} (${card.artStyle || card.variant || 'alt'})` : card.id;
      process.stdout.write(`  ${label.padEnd(25)} ${card.name.substring(0, 20).padEnd(20)} `);

      const product = findMatchingProduct(card, products, debug);

      if (product) {
        priceData.prices[card.id] = {
          marketPrice: product.marketPrice,
          lowPrice: product.lowPrice,
          midPrice: product.midPrice,
          highPrice: product.highPrice,
          lastUpdated: new Date().toISOString(),
          tcgplayerUrl: `https://www.tcgplayer.com/product/${product.productId}/${product.productUrlName}`,
          tcgplayerProductId: product.productId,
        };
        const displayPrice = product.marketPrice?.toFixed(2) || product.lowPrice?.toFixed(2) || 'N/A';
        console.log(`$${displayPrice}`);
        totalFound++;
      } else {
        console.log('--');
        totalNotFound++;
      }

      totalProcessed++;
    }
  }

  const totalTime = formatTime(Date.now() - startTime);

  priceData.lastUpdated = new Date().toISOString();
  fs.writeFileSync(pricesPath, JSON.stringify(priceData, null, 2));

  console.log(`\n✓ Done in ${totalTime}!`);
  console.log(`  Processed: ${totalProcessed}/${totalCards}`);
  console.log(`  Found: ${totalFound} (${((totalFound / totalProcessed) * 100).toFixed(1)}%)`);
  console.log(`  Not found: ${totalNotFound}`);
  console.log(`  Saved to: ${pricesPath}`);
}

main().catch(console.error);
