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

// Internal art style type for more precise matching
type InternalArtStyle = 'standard' | 'alternate' | 'manga' | 'super' | 'red-super' | 'wanted' | 'treasure';

// Categorize TCGPlayer product names into art styles
function getArtStyleFromName(productName: string): InternalArtStyle {
  const lower = productName.toLowerCase();

  // Check for specific art types (order matters - check most specific first)
  if (lower.includes('red super alternate')) {
    return 'red-super';
  }
  if (lower.includes('super alternate') || lower.includes('super alt')) {
    return 'super';
  }
  if (lower.includes('wanted') || lower.includes('wanted poster')) {
    return 'wanted';
  }
  if (lower.includes('manga')) {
    return 'manga';
  }
  if (lower.includes('treasure') || lower.includes('treasure cup') || lower.includes('box topper')) {
    return 'treasure';
  }
  if (lower.includes('alternate art') || lower.includes('alt art') || lower.includes('parallel') || lower.includes('art variant')) {
    return 'alternate';
  }

  return 'standard';
}

// Map our card variants to expected TCGPlayer art styles
function getExpectedArtStyle(card: Card): InternalArtStyle {
  if (!card.isParallel) {
    return 'standard';
  }

  // Use artStyle if available
  if (card.artStyle === 'manga') return 'manga';
  if (card.artStyle === 'wanted') return 'wanted';

  // For numbered variants without artStyle, map based on TCGPlayer naming:
  // p1 = Parallel (alternate art)
  // p2 = Super Alternate Art
  // p3 = Red/Color Super Alternate Art
  // p4 = Wanted Poster
  const variant = card.variant;
  if (variant === 'p1') return 'alternate';
  if (variant === 'p2') return 'super';
  if (variant === 'p3') return 'red-super';
  if (variant === 'p4') return 'wanted';

  return 'alternate';
}

async function searchTCGPlayer(card: Card, debug: boolean = false): Promise<CardPrice | null> {
  const searchPayload = {
    algorithm: 'sales_exp_fields_boosted',
    from: 0,
    size: 50,
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
    // Extract card number from baseId (e.g., "OP13-118" -> "118")
    const cardNum = card.baseId.match(/-(\d+)$/)?.[1] || '';

    // Best search format: "Monkey.D.Luffy 118" (name + card number only)
    // TCGPlayer doesn't match well with set prefixes like "OP13-118"
    let searchQuery = `${card.name} ${cardNum}`;
    let url = `${TCGPLAYER_SEARCH_URL}?q=${encodeURIComponent(searchQuery)}&isList=false`;
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
      if (debug) console.error(`HTTP ${response.status}`);
      return null;
    }

    let data = await response.json();
    let allResults: TCGPlayerProduct[] = (data as any).results?.[0]?.results || [];

    if (debug) {
      console.log(`\n  Search: "${searchQuery}" -> ${allResults.length} results`);
    }

    // If no results, try with full baseId
    if (allResults.length === 0) {
      const altQuery = `${card.name} ${card.baseId}`;
      const altUrl = `${TCGPLAYER_SEARCH_URL}?q=${encodeURIComponent(altQuery)}&isList=false`;
      const altResponse = await fetch(altUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        body: JSON.stringify(searchPayload),
      });
      if (altResponse.ok) {
        data = await altResponse.json();
        allResults = (data as any).results?.[0]?.results || [];
        if (debug) {
          console.log(`  Fallback "${altQuery}" -> ${allResults.length} results`);
        }
      }
    }

    if (debug && allResults.length > 0) {
      console.log(`  Top results:`);
      allResults.slice(0, 8).forEach((r, i) => {
        console.log(`    ${i + 1}. ${r.productName} [${r.customAttributes?.number}] - $${r.marketPrice}`);
      });
    }

    // Extract card number from baseId (e.g., "OP13-118" -> "118")
    const cardNumberMatch = card.baseId.match(/\d+$/);
    const cardNumber = cardNumberMatch ? cardNumberMatch[0] : null;

    // Filter to cards matching our card number
    // Check both full ID (OP13-118) and just the number (118)
    const matchingCards = allResults.filter((r) => {
      const num = r.customAttributes?.number?.toUpperCase() || '';
      const baseIdUpper = card.baseId.toUpperCase();

      // Match full ID (OP13-118)
      if (num === baseIdUpper) return true;

      // Match just the number part (118)
      if (cardNumber && num === cardNumber) return true;

      // Match with set prefix variations (OP13-118 or OP-13-118)
      if (num.replace(/-/g, '') === baseIdUpper.replace(/-/g, '')) return true;

      return false;
    });

    if (debug) {
      console.log(`  Matching cards (${matchingCards.length}):`);
      matchingCards.forEach((r, i) => {
        const style = getArtStyleFromName(r.productName);
        console.log(`    ${i + 1}. [${style}] ${r.productName} - $${r.marketPrice}`);
      });
    }

    if (matchingCards.length === 0) {
      return null;
    }

    // Get expected art style for this card
    const expectedStyle = getExpectedArtStyle(card);

    if (debug) {
      console.log(`  Looking for art style: ${expectedStyle}`);
    }

    // Find the best matching result based on art style
    let result: TCGPlayerProduct | undefined;

    if (!card.isParallel) {
      // For base cards, prefer standard (non-alternate) versions
      result = matchingCards.find((r) => getArtStyleFromName(r.productName) === 'standard');
    } else {
      // For parallel cards, try to match the specific art style
      result = matchingCards.find((r) => getArtStyleFromName(r.productName) === expectedStyle);

      // If no exact match, try similar styles
      if (!result && expectedStyle === 'red-super') {
        // Fall back to regular super if no red super found
        result = matchingCards.find((r) => ['red-super', 'super', 'alternate'].includes(getArtStyleFromName(r.productName)));
      }
      if (!result && expectedStyle === 'super') {
        result = matchingCards.find((r) => ['super', 'red-super', 'alternate'].includes(getArtStyleFromName(r.productName)));
      }
      if (!result && expectedStyle === 'wanted') {
        result = matchingCards.find((r) => ['wanted', 'super', 'alternate'].includes(getArtStyleFromName(r.productName)));
      }
      if (!result && expectedStyle === 'manga') {
        result = matchingCards.find((r) => ['manga', 'alternate'].includes(getArtStyleFromName(r.productName)));
      }
      if (!result && expectedStyle === 'alternate') {
        // For general alternate, prefer the plain alternate art, not super or manga
        result = matchingCards.find((r) => getArtStyleFromName(r.productName) === 'alternate');
      }

      // Fall back to any non-standard version
      if (!result) {
        result = matchingCards.find((r) => getArtStyleFromName(r.productName) !== 'standard');
      }
    }

    // Final fallback to first match
    if (!result) {
      result = matchingCards[0];
    }

    if (!result) return null;

    if (debug) {
      console.log(`  Selected: ${result.productName} - $${result.marketPrice}`);
    }

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
    if (debug) console.error('Error:', error);
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
  const cardFilter = args.find(a => a.startsWith('--card='))?.split('=')[1];
  const debug = args.includes('--debug');
  const limit = limitArg ? parseInt(limitArg, 10) : Infinity;
  const delayMs = 250;

  console.log('Starting TCGPlayer price scrape...');
  if (setFilter) console.log(`Filtering to set: ${setFilter}`);
  if (cardFilter) console.log(`Filtering to card: ${cardFilter}`);
  if (limit < Infinity) console.log(`Limiting to ${limit} cards`);
  if (debug) console.log('Debug mode enabled');

  let processed = 0;
  let found = 0;
  let notFound = 0;

  for (const set of database.sets) {
    if (setFilter && set.id !== setFilter) continue;

    console.log(`\nProcessing ${set.name} (${set.cards.length} cards)...`);

    for (const card of set.cards) {
      if (processed >= limit) break;

      // Filter by card ID if specified
      if (cardFilter && !card.id.toLowerCase().includes(cardFilter.toLowerCase())) {
        continue;
      }

      const label = card.isParallel ? `${card.id} (${card.artStyle || card.variant || 'alt'})` : card.id;
      process.stdout.write(`  ${label.padEnd(25)} ${card.name.substring(0, 20).padEnd(20)} `);

      const price = await searchTCGPlayer(card, debug);

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
