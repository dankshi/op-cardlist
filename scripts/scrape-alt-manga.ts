import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

const ALT_GRAPHQL = 'https://alt-platform-server.production.internal.onlyalt.com/graphql';

const MANGA_CARDS = [
  { set: 'OP-01', name: 'Shanks "Romance Dawn"', id: '44d0ebc5-0cfb-42f3-9cc3-96edc39cf065' },
  { set: 'OP-02', name: 'Ace "Paramount War"', id: 'e9b30914-f052-4089-ac87-28bf6c53aa9c' },
  { set: 'OP-03', name: 'Sogeking "Pillars of Strength"', id: 'c7871bd3-e88f-47d1-af76-afadb223b658' },
  { set: 'OP-04', name: 'Sabo', id: '744164f0-eada-4e92-80ca-197ec7880ab0' },
  { set: 'OP-05', name: 'Trafalgar Law', id: '3c2e11f0-fc79-44a1-886a-3b05924ba9a2' },
  { set: 'OP-05', name: 'Eustass Captain Kid', id: '552bb5b0-3135-4183-95c4-4ee958ac4134' },
  { set: 'OP-05', name: 'Monkey D. Luffy "Awakening of the new era"', id: '1421ea73-f11c-4aa2-8853-966330289831' },
  { set: 'OP-06', name: 'Roronoa Zoro', id: '6600e6db-e019-4558-b954-5c156f8566be' },
  { set: 'EB-01', name: 'Tony Tony Chopper', id: '85cf1d5b-d4d5-4555-9925-35ce3cac6869' },
  { set: 'OP-07', name: 'Boa Hancock', id: '38cb504f-d34e-44c7-b7c0-67d907f6a596' },
  { set: 'OP-08', name: 'Silvers Rayleigh', id: '8063e776-4c2a-4650-9923-87fbea0ab21a' },
  { set: 'PRB-01', name: 'Sogeking "The Best"', id: '418bd24c-39ca-4a32-81db-d67c49b41517' },
  { set: 'PRB-01', name: 'Portgas D. Ace "The Best"', id: '70da5072-3223-4d35-b116-c0afa137caf0' },
  { set: 'PRB-01', name: 'Nami', id: '2d199164-5962-4014-9beb-3a3059e17786' },
  { set: 'PRB-01', name: 'Tony Tony Chopper', id: 'ecd9d330-0ee0-40d0-982f-8cc205d1867f' },
  { set: 'PRB-01', name: 'Sabo', id: 'af8b25f7-af69-4c44-a069-9fefb92452a4' },
  { set: 'PRB-01', name: 'Eustass Captain Kid', id: 'eb110267-b7f4-4879-98af-84032a84cf38' },
  { set: 'PRB-01', name: 'Shanks', id: '4c012a92-93a9-422d-be87-35ef7211e36a' },
  { set: 'PRB-01', name: 'Zoro "The Best"', id: '43afbffc-f906-4f3a-9b62-24147db61d56' },
  { set: 'PRB-01', name: 'Law "The Best"', id: '4a8723ef-561d-42da-ac21-348602a7c2d0' },
  { set: 'PRB-01', name: 'Monkey D Luffy "The Best"', id: '9b244e68-cd9e-49f1-94a3-2a959c2658bb' },
  { set: 'OP-09', name: 'Gol D Roger', id: '01c48908-9214-4372-9ab2-92e369fcbfea' },
  { set: 'OP-09', name: 'Marshall D. Teach', id: '713f0e19-0d28-4b28-bf0e-4b6de90fa3dc' },
  { set: 'OP-09', name: 'Shanks', id: 'e33e2eec-cbac-4740-ba16-bbe525ec439a' },
  { set: 'OP-09', name: 'Buggy', id: '5d54a4a6-a685-417d-bf68-5611d912d8ba' },
  { set: 'OP-09', name: 'Monkey D Luffy "Emperors in the New World"', id: '187ae86e-7c9a-46ed-925b-41203b07e242' },
  { set: 'OP-10', name: 'Trafalgar Law "Royal Blood"', id: '689cb261-1492-4032-9c9a-3dac0eb74452' },
  { set: 'EB-01', name: 'Monkey D Luffy "Anime25th Collection"', id: '47586d38-66e4-45c2-995a-c25942b9f77d' },
  { set: 'OP-11', name: 'Monkey D Luffy "A Fist of Divine Speed"', id: '305809f6-f847-4e0e-8215-3d724cdbb5a0' },
  { set: 'OP-12', name: 'Jewelry Bonney', id: 'c9425f05-fbdc-47b4-ace2-4df7421ba0da' },
  { set: 'PRB-02', name: 'Sanji', id: 'ccb3512d-d3f8-4be7-86e8-1026b6a1b5ae' },
  { set: 'OP-13', name: 'Portgas D. Ace "Carrying on His Will"', id: '2aa167a9-11d3-4d70-ad77-922ac4594800' },
  { set: 'OP-13', name: 'Sabo "Carrying on His Will"', id: '1e038d7f-f0c1-4358-9180-c8a0f450c775' },
  { set: 'OP-13', name: 'Monkey D Luffy "Carrying on His Will"', id: '43fbad5b-7480-4dc5-9a34-3276978c8109' },
  { set: 'OP-13', name: 'Ace Red Manga', id: '06893345-ab66-4936-8c7e-545383a3c591' },
  { set: 'OP-13', name: 'Sabo Red Manga', id: '1419b51b-ccce-4a1f-920b-9d437f51fe6b' },
  { set: 'OP-13', name: 'Luffy Red Manga', id: 'ef2cabb5-4e79-4963-882c-4c89a2760ed0' },
  { set: 'OP-14', name: 'Mihawk', id: '005905c9-6c88-4174-9a9a-15cef062c9c9' },
  { set: 'EB-03', name: 'Uta', id: '890a4de5-b523-4490-951a-9b666bb669a0' },
];

// Note: OP-15 Enel is "not found" on alt.xyz, skipped

interface CardPop {
  gradingCompany: string;
  gradeNumber: string;
  count: number;
}

const LISTING_QUERY = `query ExternalListing($id: ID!) {
  liveExternalTransaction(id: $id) {
    id
    asset { id name subject brand variety attributes { cardNumber __typename } __typename }
    attributes { grade gradingCompany __typename }
    buyItNowPrice
    images { position url __typename }
    __typename
  }
}`;

const POPS_QUERY = `query AssetCardPops($id: ID!) {
  asset(id: $id) {
    id
    cardPops { gradingCompany gradeNumber count __typename }
    __typename
  }
}`;

const SEARCH_CONFIG_QUERY = `query SearchServiceConfig {
  serviceConfig {
    search {
      universalSearch {
        clientConfig { nodes { host port protocol __typename } apiKey __typename }
        collectionName expiresAt __typename
      } __typename
    } __typename
  }
}`;

async function gqlFetch(operation: string, query: string, variables: Record<string, any>) {
  const res = await fetch(`${ALT_GRAPHQL}/${operation}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://alt.xyz',
      'Authorization': '',
      'Allow-Read-Replica': 'true',
    },
    body: JSON.stringify({ operationName: operation, variables, query }),
  });
  if (!res.ok) throw new Error(`GraphQL ${operation} failed: ${res.status}`);
  return res.json();
}

function parsePops(pops: CardPop[]) {
  const result = {
    psa_10: 0, psa_9: 0, psa_8: 0, psa_7: 0, psa_other: 0, psa_total: 0,
    bgs_bl: 0, bgs_10: 0, bgs_95: 0, bgs_9: 0, bgs_other: 0, bgs_total: 0,
    cgc_10: 0, cgc_95: 0, cgc_other: 0, cgc_total: 0,
  };

  for (const pop of pops) {
    if (pop.count === 0) continue;
    const grade = parseFloat(pop.gradeNumber);
    const company = pop.gradingCompany;

    if (company === 'PSA') {
      if (grade === 10) result.psa_10 = pop.count;
      else if (grade === 9) result.psa_9 = pop.count;
      else if (grade === 8) result.psa_8 = pop.count;
      else if (grade === 7) result.psa_7 = pop.count;
      else result.psa_other += pop.count;
      result.psa_total += pop.count;
    } else if (company === 'BGS') {
      if (grade === 10.5) result.bgs_bl = pop.count;       // Black Label (Pristine)
      else if (grade === 10) result.bgs_10 = pop.count;    // Gem Mint
      else if (grade === 9.5) result.bgs_95 = pop.count;
      else if (grade === 9) result.bgs_9 = pop.count;
      else result.bgs_other += pop.count;
      result.bgs_total += pop.count;
    } else if (company === 'CGC') {
      if (grade >= 10) result.cgc_10 += pop.count;
      else if (grade === 9.5) result.cgc_95 = pop.count;
      else result.cgc_other += pop.count;
      result.cgc_total += pop.count;
    }
  }

  return result;
}

async function getSearchConfig(): Promise<{ baseUrl: string; apiKey: string; collection: string } | null> {
  try {
    const res = await gqlFetch('SearchServiceConfig', SEARCH_CONFIG_QUERY, {});
    const config = res.data?.serviceConfig?.search?.universalSearch;
    if (!config) return null;
    const { nodes, apiKey } = config.clientConfig;
    const node = nodes[0];
    return {
      baseUrl: `${node.protocol}://${node.host}:${node.port}`,
      apiKey,
      collection: config.collectionName,
    };
  } catch {
    return null;
  }
}

async function fetchListings(
  searchConfig: { baseUrl: string; apiKey: string; collection: string },
  assetId: string
): Promise<any[]> {
  try {
    const res = await fetch(
      `${searchConfig.baseUrl}/multi_search?collection=${searchConfig.collection}&use_cache=true&x-typesense-api-key=${searchConfig.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          searches: [{
            q: '*',
            query_by: 'subject',
            filter_by: `assetId:=${assetId}`,
            sort_by: 'createdAt:desc',
            per_page: 20,
          }],
        }),
      }
    );
    const data = await res.json();
    return data.results?.[0]?.hits?.map((h: any) => h.document) || [];
  } catch {
    return [];
  }
}

async function scrapeCard(
  card: typeof MANGA_CARDS[0],
  supabase: ReturnType<typeof createClient>,
  searchConfig: { baseUrl: string; apiKey: string; collection: string } | null,
) {
  try {
    // Step 1: Get listing details
    const listingRes = await gqlFetch('ExternalListing', LISTING_QUERY, { id: card.id });
    const listing = listingRes.data?.liveExternalTransaction;

    let assetId: string | null = null;

    if (!listing) {
      console.log(`  ⚠ No listing found for ${card.name} (${card.set})`);
      await supabase.from('alt_manga_tracker').upsert({
        alt_listing_id: card.id,
        set_code: card.set,
        card_name: card.name,
        alt_url: `https://alt.xyz/itm/${card.id}/external`,
        last_scraped_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'alt_listing_id' });
      return;
    }

    const asset = listing.asset;
    assetId = asset.id;
    const price = listing.buyItNowPrice;
    const imageUrl = listing.images?.[0]?.url || null;

    // Step 2: Get population data
    const popsRes = await gqlFetch('AssetCardPops', POPS_QUERY, { id: assetId });
    const pops = popsRes.data?.asset?.cardPops || [];
    const popData = parsePops(pops);

    // Step 3: Upsert to database
    const row = {
      alt_listing_id: card.id,
      alt_asset_id: assetId,
      set_code: card.set,
      card_name: card.name,
      alt_url: `https://alt.xyz/itm/${card.id}/external`,
      full_name: asset.name,
      subject: asset.subject,
      brand: asset.brand,
      variety: asset.variety,
      card_number: asset.attributes?.cardNumber || null,
      image_url: imageUrl,
      lowest_price: price,
      ...popData,
      last_scraped_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from('alt_manga_tracker').upsert(row, { onConflict: 'alt_listing_id' });
    if (error) throw error;

    // Step 4: Record history snapshot
    const { data: tracker } = await supabase
      .from('alt_manga_tracker')
      .select('id')
      .eq('alt_listing_id', card.id)
      .single();

    if (tracker) {
      await supabase.from('alt_manga_tracker_history').insert({
        tracker_id: tracker.id,
        lowest_price: price,
        psa_10: popData.psa_10,
        psa_9: popData.psa_9,
        psa_total: popData.psa_total,
        bgs_95: popData.bgs_95,
        bgs_total: popData.bgs_total,
        cgc_10: popData.cgc_10,
        cgc_total: popData.cgc_total,
      });
    }

    // Step 5: Fetch and store recent listings from typesense
    if (searchConfig && assetId && tracker) {
      const listings = await fetchListings(searchConfig, assetId);
      let listingCount = 0;

      for (const l of listings) {
        const { error: lErr } = await supabase.from('alt_manga_listings').upsert({
          tracker_id: tracker.id,
          listing_id: l.listingId || l.id,
          listing_type: l.listingType,
          grading_company: l.gradingCompany,
          grade: l.grade,
          price: l.price,
          auction_house: l.auctionHouse,
          image_url: l.images?.[0]?.url || null,
          external_url: l.url || null,
          listed_at: l.createdAt ? new Date(l.createdAt * 1000).toISOString() : null,
          scraped_at: new Date().toISOString(),
        }, { onConflict: 'listing_id' });
        if (!lErr) listingCount++;
      }

      const totalPop = popData.psa_total + popData.bgs_total + popData.cgc_total;
      console.log(`  ✓ ${card.set} ${card.name} — $${price ?? 'N/A'} | PSA 10: ${popData.psa_10} | BGS BL: ${popData.bgs_bl} | Pop: ${totalPop} | ${listingCount} listings`);
    } else {
      const totalPop = popData.psa_total + popData.bgs_total + popData.cgc_total;
      console.log(`  ✓ ${card.set} ${card.name} — $${price ?? 'N/A'} | PSA 10: ${popData.psa_10} | BGS BL: ${popData.bgs_bl} | Pop: ${totalPop}`);
    }
  } catch (err: any) {
    console.error(`  ✗ ${card.set} ${card.name}: ${err.message}`);
  }
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials in .env.local');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log(`\n🎴 Alt.xyz Manga Tracker — Scraping ${MANGA_CARDS.length} cards\n`);

  // Get typesense search config for listings
  const searchConfig = await getSearchConfig();
  if (searchConfig) {
    console.log('  ✓ Search config loaded (will fetch listings)\n');
  } else {
    console.log('  ⚠ Could not load search config (skipping listings)\n');
  }

  for (const card of MANGA_CARDS) {
    await scrapeCard(card, supabase, searchConfig);
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('\n✅ Done!\n');
}

main().catch(console.error);
