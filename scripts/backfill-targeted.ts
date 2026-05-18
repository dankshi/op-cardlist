// One-shot targeted backfill: pulls fresh sales for a small set of cards
// (the 15 most-valuable cards shown on the home page + every card with
// "Sugar" in the name). Useful for seeding the chart UI on cards we know
// users will want to see before the daily rotation reaches them.
//
// Uses the same per-line authenticated fetch as the main scraper.
//
// Usage:  npx tsx scripts/backfill-targeted.ts

import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

const TCG_AUTH_COOKIE = process.env.TCGPLAYER_AUTH_COOKIE;
const PAGE_SIZE = 25;
const MAX_PAGES = 6;
const CUTOFF_DAYS = 90;
const INTER_PAGE_DELAY_MS = [400, 900];
const INTER_PRODUCT_DELAY_MS = [1500, 3000];

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase env vars');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}
function jitter([lo, hi]: number[]) {
  return lo + Math.random() * (hi - lo);
}

interface SaleResponse {
  purchasePrice: number;
  shippingPrice: number;
  orderDate: string;
  condition: string;
  variant: string;
  language: string;
  listingType: string;
  customListingId: string;
  quantity: number;
}

async function fetchAllSales(productId: number): Promise<SaleResponse[]> {
  const all: SaleResponse[] = [];
  const snapshotTime = Date.now();
  const cutoff = Date.now() - CUTOFF_DAYS * 86_400_000;

  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0) await sleep(jitter(INTER_PAGE_DELAY_MS));
    const res = await fetch(`https://mpapi.tcgplayer.com/v2/product/${productId}/latestsales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: 'https://www.tcgplayer.com',
        Referer: 'https://www.tcgplayer.com/',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
        ...(TCG_AUTH_COOKIE
          ? { Cookie: `TCGAuthTicket_Production=${TCG_AUTH_COOKIE}` }
          : {}),
      },
      body: JSON.stringify({
        conditions: [],
        languages: [],
        variants: [],
        listingType: 'All',
        offset: page * PAGE_SIZE,
        limit: PAGE_SIZE,
        time: snapshotTime,
      }),
    });
    if (!res.ok) {
      console.log(`  page ${page}: HTTP ${res.status}`);
      break;
    }
    const data = await res.json();
    const sales: SaleResponse[] = data.data ?? [];
    all.push(...sales);
    if (data.nextPage !== 'Yes') break;
    const oldest = sales[sales.length - 1];
    if (oldest && new Date(oldest.orderDate).getTime() < cutoff) break;
  }
  return all;
}

async function main() {
  if (!TCG_AUTH_COOKIE) {
    console.warn('⚠ TCGPLAYER_AUTH_COOKIE not set — will fall back to 5-sale anon cap.');
  }

  // 15 most valuable (matches home page "Most Valuable" carousel)
  const { data: topByPrice } = await supabase
    .from('tcgplayer_card_prices')
    .select('card_id, tcgplayer_product_id, tcgplayer_product_name')
    .not('market_price', 'is', null)
    .order('market_price', { ascending: false })
    .limit(15);

  // Every Sugar
  const { data: sugars } = await supabase
    .from('tcgplayer_card_prices')
    .select('card_id, tcgplayer_product_id, tcgplayer_product_name')
    .ilike('tcgplayer_product_name', '%sugar%');

  const seen = new Set<number>();
  const targets: { cardId: string; productId: number; name: string }[] = [];
  for (const r of [...(topByPrice ?? []), ...(sugars ?? [])]) {
    if (!r.tcgplayer_product_id || seen.has(r.tcgplayer_product_id)) continue;
    seen.add(r.tcgplayer_product_id);
    targets.push({
      cardId: r.card_id,
      productId: r.tcgplayer_product_id,
      name: r.tcgplayer_product_name ?? '',
    });
  }

  console.log(`Backfilling ${targets.length} target cards...`);

  let totalSales = 0;
  for (const [i, t] of targets.entries()) {
    if (i > 0) await sleep(jitter(INTER_PRODUCT_DELAY_MS));
    try {
      const sales = await fetchAllSales(t.productId);
      const rows = sales.map(s => ({
        tcgplayer_product_id: t.productId,
        sold_at: s.orderDate,
        price: s.purchasePrice,
        condition: s.condition ?? null,
        variant: s.variant ?? null,
        language: s.language ?? null,
        listing_type: s.listingType ?? null,
        shipping_price: s.shippingPrice ?? null,
        custom_listing_id: s.customListingId ?? null,
        quantity: s.quantity ?? 1,
      }));

      if (rows.length > 0) {
        const { error } = await supabase
          .from('card_sales')
          .upsert(rows, {
            onConflict: 'tcgplayer_product_id,sold_at,price,condition,variant,language',
            ignoreDuplicates: true,
          });
        if (error) console.error(`  upsert error for ${t.cardId}: ${error.message}`);

        const latest = sales[0];
        await supabase
          .from('tcgplayer_card_prices')
          .update({
            last_sold_price: latest.purchasePrice,
            last_sold_date: latest.orderDate,
            sales_scraped_at: new Date().toISOString(),
          })
          .eq('card_id', t.cardId);
      } else {
        await supabase
          .from('tcgplayer_card_prices')
          .update({ sales_scraped_at: new Date().toISOString() })
          .eq('card_id', t.cardId);
      }

      totalSales += rows.length;
      console.log(
        `  [${i + 1}/${targets.length}] ${t.cardId.padEnd(20)} ${t.name.slice(0, 40).padEnd(40)} ${rows.length} sales`,
      );
    } catch (err) {
      console.error(`  [${i + 1}/${targets.length}] ${t.cardId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\nDone. ${totalSales} total sales upserted across ${targets.length} cards.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
