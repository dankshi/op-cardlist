// Sanity-check that the authed fetchSales pipeline pulls full sales for one
// product and the new SaleRecord shape (variant/language/listingType/etc.)
// matches what we expect.
//
// Usage:  npx tsx scripts/test-fetch-sales.ts 541667

import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

const TCG_AUTH_COOKIE = process.env.TCGPLAYER_AUTH_COOKIE;
const PAGE_SIZE = 25;
const MAX_PAGES = 10;
const CUTOFF_DAYS = 90;

async function main() {
  const productId = Number(process.argv[2] ?? 541667);
  console.log(`Testing product ${productId}`);
  console.log(`Auth cookie: ${TCG_AUTH_COOKIE ? `set (${TCG_AUTH_COOKIE.length} chars)` : 'NOT SET'}`);

  const snapshotTime = Date.now();
  const cutoff = Date.now() - CUTOFF_DAYS * 86_400_000;
  const all: unknown[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE_SIZE;
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
        offset,
        limit: PAGE_SIZE,
        time: snapshotTime,
      }),
    });

    const text = await res.text();
    if (!res.ok) {
      console.log(`Page ${page}: HTTP ${res.status}`);
      console.log(text.slice(0, 200));
      break;
    }
    const data = JSON.parse(text);
    const sales = data.data ?? [];
    console.log(
      `Page ${page}: offset=${offset} returned=${sales.length} totalResults=${data.totalResults} nextPage=${JSON.stringify(data.nextPage)}`,
    );
    all.push(...sales);
    const oldest = sales[sales.length - 1];
    const oldestMs = oldest ? new Date(oldest.orderDate).getTime() : Infinity;
    if (data.nextPage !== 'Yes') break;
    if (oldestMs < cutoff) {
      console.log(`  reached 90-day cutoff at ${oldest.orderDate}`);
      break;
    }
  }

  console.log(`\nTotal sales pulled: ${all.length}`);
  if (all.length > 0) {
    console.log('\nFirst sale:', JSON.stringify(all[0], null, 2));
    console.log('Last sale:', JSON.stringify(all[all.length - 1], null, 2));
  }

  // Also write to DB so we can verify the upsert path
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey || all.length === 0) return;

  const supabase = createClient(supabaseUrl, supabaseKey);
  const rows = all.map(s => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const x = s as any;
    return {
      tcgplayer_product_id: productId,
      sold_at: x.orderDate,
      price: x.purchasePrice,
      condition: x.condition ?? null,
      variant: x.variant ?? null,
      language: x.language ?? null,
      listing_type: x.listingType ?? null,
      shipping_price: x.shippingPrice ?? null,
      custom_listing_id: x.customListingId ?? null,
      quantity: x.quantity ?? 1,
    };
  });
  const { error } = await supabase
    .from('card_sales')
    .upsert(rows, {
      onConflict: 'tcgplayer_product_id,sold_at,price,condition,variant,language',
      ignoreDuplicates: true,
    });
  if (error) console.error('Upsert error:', error.message);
  else console.log(`\nUpserted ${rows.length} rows into card_sales.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
