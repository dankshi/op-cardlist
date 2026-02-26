import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

const TCGPLAYER_SEARCH_URL = 'https://mp-search-api.tcgplayer.com/v1/search/request';

interface TCGPlayerProduct {
  productId: number;
  productName: string;
  marketPrice: number | null;
  lowestPrice: number | null;
  medianPrice: number | null;
  totalListings: number | null;
  productUrlName: string;
  setName: string;
  customAttributes: {
    number?: string;
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function displayNameToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[.:,!?()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

// Fetch all products for a set by its display name (what TCGPlayer API expects)
async function fetchSetProducts(displayName: string, debug: boolean): Promise<TCGPlayerProduct[]> {
  const products: TCGPlayerProduct[] = [];
  const PAGE_SIZE = 50;
  let from = 0;
  let totalResults = Infinity;

  while (from < totalResults) {
    const payload = {
      algorithm: 'sales_exp_fields_boosted',
      from,
      size: PAGE_SIZE,
      filters: {
        term: {
          productLineName: ['one-piece-card-game'],
          productTypeName: ['Cards'],
          setName: [displayName],
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

    try {
      const response = await fetch(`${TCGPLAYER_SEARCH_URL}?q=&isList=false`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        if (response.status === 429) {
          if (debug) console.log('    Rate limited, waiting 5s...');
          await sleep(5000);
          continue;
        }
        if (debug) console.error(`    HTTP ${response.status}`);
        break;
      }

      const data = await response.json();
      const resultBlock = (data as any).results?.[0];
      totalResults = resultBlock?.totalResults ?? 0;
      const results: TCGPlayerProduct[] = resultBlock?.results ?? [];

      products.push(...results);
      from += PAGE_SIZE;

      if (results.length < PAGE_SIZE) break;
      await sleep(100);
    } catch (error) {
      if (debug) console.error('    Fetch error:', error);
      break;
    }
  }

  return products;
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const args = process.argv.slice(2);
  const debug = args.includes('--debug');
  const setFilter = args.find(a => a.startsWith('--set='))?.split('=')[1];

  // Fetch all discovered TCGPlayer sets from DB
  const { data: tcgSets, error } = await supabase
    .from('tcgplayer_sets')
    .select('set_name, display_name, product_count')
    .order('product_count', { ascending: false });

  if (error || !tcgSets) {
    console.error('Error fetching tcgplayer_sets:', error?.message);
    process.exit(1);
  }

  // Filter if requested (exact match on set_name slug)
  const setsToScrape = setFilter
    ? tcgSets.filter(s => s.set_name === setFilter)
    : tcgSets.filter(s => s.product_count > 0);

  console.log(`Scraping ${setsToScrape.length} TCGPlayer sets...`);

  let totalProducts = 0;
  let totalSets = 0;
  const startTime = Date.now();

  for (const set of setsToScrape) {
    process.stdout.write(`  ${set.set_name.padEnd(60)} `);

    // Try slug first (canonical format), fall back to display name if filter fails
    let products = await fetchSetProducts(set.set_name, debug);
    const expectedCount = set.product_count || 0;

    // Safety check: if product count is wildly higher than expected, the API
    // likely didn't recognize the slug. Try the display name instead.
    if (expectedCount > 0 && products.length > expectedCount * 2) {
      if (debug) console.log(`\n    Slug "${set.set_name}" returned ${products.length} (expected ~${expectedCount}), trying display name...`);
      products = await fetchSetProducts(set.display_name, debug);

      // If still way off, skip entirely
      if (products.length > expectedCount * 2) {
        console.log(`SKIPPED (got ${products.length}, expected ~${expectedCount} — filter failed)`);
        continue;
      }
    }

    if (products.length === 0) {
      console.log('0 products (skipped)');
      continue;
    }

    // Prepare rows for upsert — deduplicate by product_id (TCGPlayer can return dupes)
    const slug = set.set_name;
    const seen = new Set<number>();
    const rows: any[] = [];
    for (const p of products) {
      if (seen.has(p.productId)) continue;
      seen.add(p.productId);
      rows.push({
        product_id: p.productId,
        product_name: p.productName,
        set_name: slug,
        card_number: p.customAttributes?.number?.toUpperCase() || null,
        product_url_name: p.productUrlName,
        market_price: p.marketPrice,
        lowest_price: p.lowestPrice,
        median_price: p.medianPrice,
        total_listings: p.totalListings,
      });
    }

    // Batch upsert
    const BATCH_SIZE = 200;
    let upsertError = false;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error: upsertErr } = await supabase
        .from('tcgplayer_products')
        .upsert(batch, { onConflict: 'product_id' });

      if (upsertErr) {
        console.log(`ERROR: ${upsertErr.message}`);
        upsertError = true;
        break;
      }
    }

    if (!upsertError) {
      console.log(`${products.length} products`);
      totalProducts += products.length;
      totalSets++;
    }

    await sleep(150);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\nDone in ${elapsed}s — ${totalSets} sets, ${totalProducts} products saved to tcgplayer_products`);
}

main().catch(console.error);
