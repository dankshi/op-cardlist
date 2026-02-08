import * as fs from 'fs';
import * as path from 'path';

const TCGPLAYER_SEARCH_URL = 'https://mp-search-api.tcgplayer.com/v1/search/request';

interface TCGPlayerProduct {
  productId: number;
  productName: string;
  productUrlName: string;
  imageUrl?: string;
  lowestPrice?: number;
}

interface SetImageData {
  setId: string;
  setName: string;
  boosterBoxImageUrl: string | null;
  tcgplayerUrl: string | null;
  tcgplayerProductId: number | null;
  lastUpdated: string;
}

interface SetImagesDatabase {
  sets: Record<string, SetImageData>;
  lastUpdated: string;
}

// Map of set IDs to their TCGPlayer search names for booster boxes
// The first element is the search query, the second is a keyword to match in results
const SET_SEARCH_CONFIG: Record<string, { query: string; matchKeyword?: string }> = {
  'op-01': { query: 'Romance Dawn Booster Box' },
  'op-02': { query: 'Paramount War Booster Box' },
  'op-03': { query: 'Pillars of Strength Booster Box' },
  'op-04': { query: 'Kingdoms of Intrigue Booster Box' },
  'op-05': { query: 'Awakening of the New Era Booster Box' },
  'op-06': { query: 'Wings of the Captain Booster Box' },
  'op-07': { query: '500 Years in the Future Booster Box' },
  'op-08': { query: 'Two Legends Booster Box' },
  'op-09': { query: 'Emperors in the New World Booster Box' },
  'op-10': { query: 'Royal Blood Booster Box' },
  'op-11': { query: 'A Fist of Divine Speed Booster Box', matchKeyword: 'divine speed' },
  'op-12': { query: 'Legacy of the Master Booster Box', matchKeyword: 'legacy' },
  'op-13': { query: 'Carrying on His Will Booster Box' },
  'eb-01': { query: 'Memorial Collection Booster Box' },
  'eb-02': { query: 'Anime 25th Collection Booster Box', matchKeyword: 'anime 25th' },
  'eb-03': { query: 'Heroines Edition Booster Box', matchKeyword: 'heroines' },
  'op14-eb04': { query: 'Azure Sea Seven Booster Box' },
  'prb-01': { query: 'Premium Booster One Piece Card The Best' },
};

async function searchBoosterBox(setId: string, config: { query: string; matchKeyword?: string }, debug: boolean = false): Promise<SetImageData | null> {
  const { query: searchName, matchKeyword } = config;
  const searchPayload = {
    algorithm: 'sales_exp_fields_boosted',
    from: 0,
    size: 50,
    filters: {
      term: {
        productLineName: ['one-piece-card-game'],
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
    const url = `${TCGPLAYER_SEARCH_URL}?q=${encodeURIComponent(searchName)}&isList=false`;
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
      console.error(`  HTTP ${response.status} for ${setId}`);
      return null;
    }

    const data = await response.json();
    const results: TCGPlayerProduct[] = (data as any).results?.[0]?.results || [];

    if (debug) {
      console.log(`  Raw results: ${results.length}`);
      results.slice(0, 10).forEach((r, i) => {
        console.log(`    ${i + 1}. ${r.productName}`);
      });
    }

    if (results.length === 0) {
      console.log(`  No results found for ${searchName}`);
      return null;
    }

    // Find the best matching booster box (prefer English, exact match)
    // Include various box naming patterns: "Booster Box", "Edition Box", "Collection Box"
    let boosterBoxes = results.filter(r => {
      const name = r.productName.toLowerCase();
      const isBox = name.includes('booster box') ||
                    name.includes('edition box') ||
                    name.includes('collection box');
      const isNotCase = !name.includes('case');
      const isNotJapanese = !name.includes('japanese');
      return isBox && isNotCase && isNotJapanese;
    });

    // If we have a match keyword, prefer results containing it
    if (matchKeyword) {
      const keywordMatches = boosterBoxes.filter(r =>
        r.productName.toLowerCase().includes(matchKeyword.toLowerCase())
      );
      if (keywordMatches.length > 0) {
        boosterBoxes = keywordMatches;
      }
    }

    if (debug) {
      console.log(`  Booster boxes found: ${boosterBoxes.length}`);
      boosterBoxes.slice(0, 5).forEach((r, i) => console.log(`    ${i + 1}. ${r.productName} - ID: ${r.productId}`));
    }

    const bestMatch = boosterBoxes[0];

    if (!bestMatch) {
      console.log(`  No booster box found in results`);
      return null;
    }

    console.log(`  Found: ${bestMatch.productName} (ID: ${bestMatch.productId})`);

    // TCGPlayer product image URL pattern - use 400w for higher quality
    const imageUrl = `https://tcgplayer-cdn.tcgplayer.com/product/${bestMatch.productId}_400w.jpg`;
    const tcgplayerUrl = `https://www.tcgplayer.com/product/${bestMatch.productId}/${bestMatch.productUrlName}`;

    return {
      setId,
      setName: searchName.replace(' Booster Box', '').replace(' Booster', ''),
      boosterBoxImageUrl: imageUrl,
      tcgplayerUrl,
      tcgplayerProductId: bestMatch.productId,
      lastUpdated: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`  Error searching for ${setId}:`, error);
    return null;
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const dataDir = path.join(process.cwd(), 'data');
  const outputPath = path.join(dataDir, 'set-images.json');

  // Load existing data if present
  let database: SetImagesDatabase = {
    sets: {},
    lastUpdated: new Date().toISOString(),
  };

  if (fs.existsSync(outputPath)) {
    database = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
  }

  const args = process.argv.slice(2);
  const setFilter = args.find(a => a.startsWith('--set='))?.split('=')[1];
  const forceUpdate = args.includes('--force');
  const debug = args.includes('--debug');

  console.log('Starting TCGPlayer booster box image scrape...');
  if (setFilter) console.log(`Filtering to set: ${setFilter}`);
  if (forceUpdate) console.log('Force update enabled');
  if (debug) console.log('Debug mode enabled');

  let processed = 0;
  let found = 0;

  for (const [setId, config] of Object.entries(SET_SEARCH_CONFIG)) {
    if (setFilter && setId !== setFilter) continue;

    // Skip if already have data and not forcing update
    if (database.sets[setId] && !forceUpdate) {
      console.log(`Skipping ${setId} (already have data)`);
      continue;
    }

    console.log(`\nSearching for ${setId}: ${config.query}...`);

    const result = await searchBoosterBox(setId, config, debug);
    if (result) {
      database.sets[setId] = result;
      found++;
    }

    processed++;
    await sleep(300); // Rate limiting
  }

  database.lastUpdated = new Date().toISOString();
  fs.writeFileSync(outputPath, JSON.stringify(database, null, 2));

  console.log(`\n✓ Done!`);
  console.log(`  Processed: ${processed}`);
  console.log(`  Found: ${found}`);
  console.log(`  Saved to: ${outputPath}`);
}

main().catch(console.error);
