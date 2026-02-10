import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { SET_NAME_MAP } from '../src/lib/set-names';

dotenv.config({ path: '.env.local' });

const TCGPLAYER_SEARCH_URL = 'https://mp-search-api.tcgplayer.com/v1/search/request';

// All Bandai sets we track (from scripts/scrape.ts SETS dictionary)
const BANDAI_SETS: Record<string, string> = {
  'op-01': 'OP-01 - Romance Dawn',
  'op-02': 'OP-02 - Paramount War',
  'op-03': 'OP-03 - Pillars of Strength',
  'op-04': 'OP-04 - Kingdoms of Intrigue',
  'op-05': 'OP-05 - Awakening of the New Era',
  'op-06': 'OP-06 - Wings of the Captain',
  'op-07': 'OP-07 - 500 Years in the Future',
  'op-08': 'OP-08 - Two Legends',
  'op-09': 'OP-09 - Emperors in the New World',
  'op-10': 'OP-10 - Royal Blood',
  'op-11': 'OP-11 - A Fist of Divine Speed',
  'op-12': 'OP-12 - Legacy of the Master',
  'op-13': 'OP-13 - Carrying On His Will',
  'eb-01': 'EB-01 - Memorial Collection',
  'eb-02': 'EB-02 - Anime 25th Collection',
  'eb-03': 'EB-03 - One Piece Heroines Edition',
  'op14-eb04': 'OP14-EB04 - The Azure Sea\'s Seven',
  'prb-01': 'PRB-01 - One Piece Card The Best',
  'promo': 'Promotion Cards',
  'other-product': 'Other Product Cards',
};

interface SetStats {
  displayName: string;
  count: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Prettify a TCGPlayer URL slug into a display name
// e.g. "romance-dawn-pre-release-cards" -> "Romance Dawn Pre Release Cards"
function slugToDisplayName(slug: string): string {
  return slug
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Discover all TCGPlayer sets by paginating through all One Piece products
async function discoverSets(debug: boolean): Promise<Map<string, SetStats>> {
  const setStats = new Map<string, SetStats>();
  const PAGE_SIZE = 50;
  let from = 0;
  let totalResults = Infinity;
  let pagesProcessed = 0;

  console.log('Discovering TCGPlayer sets for One Piece Card Game...');

  while (from < totalResults) {
    const payload = {
      algorithm: 'sales_exp_fields_boosted',
      from,
      size: PAGE_SIZE,
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
        console.error(`HTTP ${response.status} at offset ${from}`);
        if (response.status === 429) {
          console.log('Rate limited, waiting 5s...');
          await sleep(5000);
          continue; // Retry same page
        }
        break;
      }

      const data = await response.json();
      const resultBlock = (data as any).results?.[0];
      totalResults = resultBlock?.totalResults ?? 0;
      const products = resultBlock?.results ?? [];

      if (pagesProcessed === 0) {
        console.log(`Total products to scan: ${totalResults}`);
      }

      for (const product of products) {
        const setName = product.setName;
        if (setName) {
          const existing = setStats.get(setName);
          if (existing) {
            existing.count++;
          } else {
            setStats.set(setName, {
              displayName: slugToDisplayName(setName),
              count: 1,
            });
          }
        }
      }

      pagesProcessed++;
      from += PAGE_SIZE;

      if (pagesProcessed % 10 === 0 || debug) {
        const pct = totalResults > 0 ? ((from / totalResults) * 100).toFixed(1) : '0';
        process.stdout.write(`  Scanned ${Math.min(from, totalResults)}/${totalResults} products (${pct}%) - ${setStats.size} sets found\r`);
      }

      await sleep(150); // Rate limit
    } catch (error) {
      console.error(`Error at offset ${from}:`, error);
      break;
    }
  }

  console.log(`\nDiscovery complete: ${setStats.size} sets found across ${totalResults} products`);
  return setStats;
}

// Seed set_mappings from the hardcoded SET_NAME_MAP
async function seedMappings(supabase: any, debug: boolean) {
  console.log('\nSeeding set_mappings from SET_NAME_MAP...');

  // First ensure all referenced TCGPlayer set names exist in tcgplayer_sets (for FK)
  const allTcgNames: { set_name: string; display_name: string; product_count: number }[] = [];
  for (const tcgNames of Object.values(SET_NAME_MAP)) {
    for (const name of tcgNames) {
      allTcgNames.push({
        set_name: name,
        display_name: slugToDisplayName(name),
        product_count: 0, // Will be updated by discovery
      });
    }
  }

  if (allTcgNames.length > 0) {
    const { error } = await supabase
      .from('tcgplayer_sets')
      .upsert(allTcgNames, { onConflict: 'set_name', ignoreDuplicates: true });

    if (error) {
      console.error('Error ensuring tcgplayer_sets entries:', error.message);
      return;
    }
  }

  // Now seed the mappings
  let seeded = 0;
  for (const [bandaiSetId, tcgNames] of Object.entries(SET_NAME_MAP)) {
    for (let i = 0; i < tcgNames.length; i++) {
      const { error } = await supabase
        .from('set_mappings')
        .upsert({
          bandai_set_id: bandaiSetId,
          tcgplayer_set_name: tcgNames[i],
          is_primary: i === 0,
        }, { onConflict: 'bandai_set_id,tcgplayer_set_name' });

      if (error) {
        console.error(`  Error seeding ${bandaiSetId} -> ${tcgNames[i]}:`, error.message);
      } else {
        seeded++;
        if (debug) console.log(`  ${bandaiSetId} -> ${tcgNames[i]}${i === 0 ? ' [primary]' : ''}`);
      }
    }
  }

  console.log(`Seeded ${seeded} mappings from SET_NAME_MAP`);
}

// Print mapping coverage report
async function printReport(supabase: any) {
  // Fetch all discovered TCGPlayer sets
  const { data: tcgSets, error: tcgError } = await supabase
    .from('tcgplayer_sets')
    .select('*')
    .order('product_count', { ascending: false });

  if (tcgError) {
    console.error('Error fetching tcgplayer_sets:', tcgError.message);
    return;
  }

  // Fetch all mappings
  const { data: mappings, error: mapError } = await supabase
    .from('set_mappings')
    .select('*')
    .order('bandai_set_id');

  if (mapError) {
    console.error('Error fetching set_mappings:', mapError.message);
    return;
  }

  // Build lookups
  const mappedTcgNames = new Set((mappings || []).map((m: any) => m.tcgplayer_set_name));
  const bandaiToTcg = new Map<string, { tcgplayer_set_name: string; is_primary: boolean }[]>();
  for (const m of (mappings || [])) {
    const list = bandaiToTcg.get(m.bandai_set_id) || [];
    list.push({ tcgplayer_set_name: m.tcgplayer_set_name, is_primary: m.is_primary });
    bandaiToTcg.set(m.bandai_set_id, list);
  }

  const tcgSetMap = new Map<string, any>();
  for (const s of (tcgSets || [])) {
    tcgSetMap.set(s.set_name, s);
  }

  // Report header
  console.log('\n========================================');
  console.log(' TCGPlayer Set Discovery Report');
  console.log(` ${new Date().toISOString()}`);
  console.log('========================================');
  console.log(`\nTotal TCGPlayer sets in DB: ${tcgSets?.length || 0}`);

  // Mapped sets
  const mappedBandaiIds = [...bandaiToTcg.keys()].sort();
  console.log(`\n--- MAPPED (${mappedBandaiIds.length} Bandai -> ${mappedTcgNames.size} TCGPlayer sets) ---\n`);

  for (const bandaiId of mappedBandaiIds) {
    const tcgEntries = bandaiToTcg.get(bandaiId) || [];
    const bandaiName = BANDAI_SETS[bandaiId] || bandaiId;

    for (let i = 0; i < tcgEntries.length; i++) {
      const entry = tcgEntries[i];
      const tcgSet = tcgSetMap.get(entry.tcgplayer_set_name);
      const count = tcgSet?.product_count || 0;
      const primary = entry.is_primary ? ' [primary]' : '';
      const prefix = i === 0 ? ` ${bandaiId.padEnd(14)}` : `${' '.padEnd(15)}`;
      console.log(`${prefix} ${entry.tcgplayer_set_name.padEnd(55)} ${String(count).padStart(4)} products${primary}`);
    }
  }

  // Unmapped TCGPlayer sets
  const unmappedTcg = (tcgSets || []).filter((s: any) => !mappedTcgNames.has(s.set_name));
  console.log(`\n--- UNMAPPED TCGPLAYER SETS (${unmappedTcg.length} sets) ---\n`);

  for (const s of unmappedTcg) {
    console.log(` ${s.set_name.padEnd(55)} ${String(s.product_count).padStart(4)} products`);
  }

  // Bandai sets without mapping
  const allBandaiIds = Object.keys(BANDAI_SETS);
  const unmappedBandai = allBandaiIds.filter(id => !bandaiToTcg.has(id));
  console.log(`\n--- BANDAI SETS WITHOUT MAPPING (${unmappedBandai.length} sets) ---\n`);

  for (const id of unmappedBandai) {
    console.log(` ${id.padEnd(14)} ${BANDAI_SETS[id]}`);
  }

  console.log('');
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
  const seedOnly = args.includes('--seed-only');
  const reportOnly = args.includes('--report-only');

  if (reportOnly) {
    await printReport(supabase);
    return;
  }

  if (!seedOnly) {
    // Discover all TCGPlayer sets
    const discoveredSets = await discoverSets(debug);

    // Upsert into tcgplayer_sets
    console.log('\nSaving discovered sets to Supabase...');
    const rows = [...discoveredSets.entries()].map(([setName, stats]) => ({
      set_name: setName,
      display_name: stats.displayName,
      product_count: stats.count,
      last_seen_at: new Date().toISOString(),
    }));

    const BATCH_SIZE = 100;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from('tcgplayer_sets')
        .upsert(batch, { onConflict: 'set_name' });

      if (error) {
        console.error(`Error upserting batch at ${i}:`, error.message);
      }
    }
    console.log(`Saved ${rows.length} sets to tcgplayer_sets`);
  }

  // Seed mappings from SET_NAME_MAP
  await seedMappings(supabase, debug);

  // Print report
  await printReport(supabase);
}

main().catch(console.error);
