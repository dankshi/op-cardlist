/** Active-listing watcher for rare TCGplayer products.
 *
 *  Polls the TCGplayer marketplace listings endpoint for each row in
 *  `listing_watches` and fires a Discord "buy alert" the moment a listing we
 *  haven't seen before goes live. Dedup state lives in `listing_watch_seen`
 *  (keyed on TCGplayer's listingId) so a listing is alerted exactly once, even
 *  though the poller re-runs every few minutes on ephemeral CI runners.
 *
 *  This is the live-inventory counterpart to scrape-prices.ts, which only sees
 *  COMPLETED sales (the `latestsales` feed). Different endpoint, different goal:
 *  scrape-prices answers "what did it sell for?", this answers "one's for sale
 *  RIGHT NOW — go buy it."
 *
 *  Usage:
 *    npm run watch:listings              # poll + alert on new listings
 *    npm run watch:listings -- --seed    # record current listings as seen WITHOUT
 *                                        #   alerting (silently onboard a watch)
 *    npm run watch:listings -- --dry-run # log what WOULD alert, write nothing
 *
 *  Env (.env.local / CI secrets):
 *    NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (writes need service role)
 *    DISCORD_WEBHOOK_URL                                   (unset = log only, no ping)
 */

import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

const LISTINGS_URL = (productId: number) =>
  `https://mp-search-api.tcgplayer.com/v1/product/${productId}/listings`;
const PAGE_SIZE = 50;
const MAX_PAGES = 4; // 200 listings is plenty — rare cards have a handful.
// Safety valve: if a product's FIRST poll surfaces more unseen listings than
// this, seed the overflow silently instead of dumping a wall of pings. Tuned
// high enough that a genuinely rare card (0-2 listings) always alerts in full.
const MAX_ALERTS_PER_PRODUCT = 10;

interface Listing {
  listingId: number;
  price: number;
  shippingPrice: number | null;
  sellerName: string | null;
  sellerRating: number | null;
  sellerSales: string | null;
  condition: string | null;
  printing: string | null;
  language: string | null;
  quantity: number;
  title: string | null;
  listedDate: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseListing(r: any): Listing {
  return {
    listingId: Math.round(Number(r.listingId)),
    price: Number(r.price),
    shippingPrice: r.shippingPrice != null ? Number(r.shippingPrice) : null,
    sellerName: r.sellerName ?? null,
    sellerRating: r.sellerRating != null ? Number(r.sellerRating) : null,
    sellerSales: r.sellerSales != null ? String(r.sellerSales) : null,
    condition: r.condition ?? null,
    printing: r.printing ?? null,
    language: r.language ?? null,
    quantity: r.quantity != null ? Math.round(Number(r.quantity)) : 1,
    title: r.customData?.title ?? null,
    listedDate: r.listedDate ?? null,
  };
}

/** Fetch all live listings for one product (cheapest first). Returns [] on any
 *  failure — a transient block must not look like "0 listings" and trigger a
 *  re-alert storm later; it just means "no new info this tick". */
async function fetchListings(productId: number): Promise<Listing[]> {
  const all: Listing[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    let data: { results?: { totalResults?: number; results?: unknown[] }[] };
    try {
      const res = await fetch(LISTINGS_URL(productId), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Origin: 'https://www.tcgplayer.com',
          Referer: 'https://www.tcgplayer.com/',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
        },
        body: JSON.stringify({
          filters: {
            term: { sellerStatus: 'Live', channelId: 0 },
            range: { quantity: { gte: 1 } },
            exclude: { channelExclusion: 0 },
          },
          from: page * PAGE_SIZE,
          size: PAGE_SIZE,
          context: { shippingCountry: 'US', cart: {} },
          sort: { field: 'price+shipping', order: 'asc' },
          aggregations: ['listingType'],
        }),
      });
      if (!res.ok) break;
      const text = await res.text();
      if (text.startsWith('<')) break; // HTML = rate-limited/blocked
      data = JSON.parse(text);
    } catch {
      break;
    }
    const rows = Array.isArray(data.results?.[0]?.results) ? data.results![0].results! : [];
    if (rows.length === 0) break;
    all.push(...rows.map(parseListing));
    if (rows.length < PAGE_SIZE) break;
    await new Promise(r => setTimeout(r, 300));
  }
  return all.filter(l => Number.isFinite(l.listingId));
}

function money(n: number | null): string {
  return n == null ? '—' : `$${n.toFixed(2)}`;
}

/** Fire-and-forget Discord buy-alert — one message per product, one embed per
 *  new listing (Discord caps at 10 embeds/message, which is our alert cap too).
 *  Never throws: a webhook hiccup must not abort the poll or lose dedup state. */
async function alertDiscord(
  webhook: string,
  watch: { label: string; tcgplayer_url: string | null },
  listings: Listing[],
): Promise<boolean> {
  const embeds = listings.map(l => {
    const ship = l.shippingPrice && l.shippingPrice > 0 ? ` +${money(l.shippingPrice)} ship` : ' + free ship';
    const seller = l.sellerName
      ? `${l.sellerName}${l.sellerRating != null ? ` · ${l.sellerRating}%` : ''}${l.sellerSales ? ` · ${l.sellerSales} sales` : ''}`
      : 'unknown seller';
    const fields = [
      { name: 'Price', value: `${money(l.price)}${ship}`, inline: true },
      { name: 'Condition', value: [l.condition, l.printing, l.language].filter(Boolean).join(' · ') || '—', inline: true },
      { name: 'Qty', value: String(l.quantity), inline: true },
      { name: 'Seller', value: seller, inline: false },
    ];
    return {
      title: `🟢 New listing — ${watch.label}`,
      url: watch.tcgplayer_url ?? undefined,
      description: l.title ? `_${l.title}_` : undefined,
      color: 0x2ecc71,
      fields,
      timestamp: l.listedDate ?? new Date().toISOString(),
    };
  });

  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `**${listings.length} new listing${listings.length > 1 ? 's' : ''}** for ${watch.label}`,
        embeds,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.warn(`  (discord ${res.status}: ${await res.text().catch(() => '')})`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`  (discord notify failed: ${(err as Error).message})`);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const seed = args.includes('--seed');
  const dryRun = args.includes('--dry-run');

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Writes to listing_watch_seen need the service role (RLS grants anon SELECT
  // only). Without it we can read + would-alert but couldn't persist dedup
  // state, which would re-ping the same listing every run — refuse instead.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
    process.exit(1);
  }
  const supabase = createClient(url, key);

  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook && !seed && !dryRun) {
    console.warn('DISCORD_WEBHOOK_URL not set — will record listings but send no alerts.');
  }

  const { data: watches, error } = await supabase
    .from('listing_watches')
    .select('product_id, label, tcgplayer_url')
    .eq('active', true)
    .order('product_id');
  if (error) {
    console.error('Failed to load listing_watches:', error.message);
    process.exit(1);
  }
  if (!watches || watches.length === 0) {
    console.log('No active watches. Add rows to listing_watches.');
    return;
  }

  console.log(`Polling ${watches.length} watched product(s)${seed ? ' [SEED]' : ''}${dryRun ? ' [DRY-RUN]' : ''}...`);
  let totalNew = 0;
  let totalAlerted = 0;

  for (const w of watches) {
    const productId = w.product_id as number;
    const label = w.label as string;
    const listings = await fetchListings(productId);

    // Which listingIds have we already recorded for this product?
    const { data: seenRows } = await supabase
      .from('listing_watch_seen')
      .select('listing_id')
      .eq('product_id', productId);
    const seenIds = new Set((seenRows ?? []).map(r => Number(r.listing_id)));

    const fresh = listings.filter(l => !seenIds.has(l.listingId));
    console.log(`  ${productId} ${label}: ${listings.length} live, ${fresh.length} new`);
    if (fresh.length === 0) continue;
    totalNew += fresh.length;

    // Decide what to alert vs. seed-silently. --seed forces everything silent;
    // otherwise alert up to the cap (cheapest first — fresh mirrors the API's
    // price-asc order) and seed any overflow.
    const willAlert = seed ? [] : fresh.slice(0, MAX_ALERTS_PER_PRODUCT);
    const willSeed = seed ? fresh : fresh.slice(MAX_ALERTS_PER_PRODUCT);
    if (!seed && willSeed.length > 0) {
      console.log(`    capping: alerting ${willAlert.length}, seeding ${willSeed.length} overflow silently`);
    }

    if (dryRun) {
      for (const l of willAlert) console.log(`    WOULD ALERT: ${money(l.price)} ${l.condition} from ${l.sellerName}`);
      continue;
    }

    let alertedOk = false;
    if (willAlert.length > 0 && webhook) {
      alertedOk = await alertDiscord(webhook, { label, tcgplayer_url: w.tcgplayer_url as string | null }, willAlert);
      if (alertedOk) totalAlerted += willAlert.length;
    }

    // Persist dedup rows. Mark a listing `alerted: true` only if the Discord
    // post actually succeeded — if it failed, leave it UNSEEN (don't insert) so
    // the next run retries it instead of silently swallowing a buy alert.
    const toInsert = [
      ...(alertedOk ? willAlert : []),
      ...willSeed,
    ].map(l => ({
      listing_id: l.listingId,
      product_id: productId,
      price: l.price,
      shipping_price: l.shippingPrice,
      seller_name: l.sellerName,
      condition: l.condition,
      quantity: l.quantity,
      title: l.title,
      alerted: alertedOk && willAlert.includes(l),
    }));
    if (toInsert.length > 0) {
      const { error: insErr } = await supabase
        .from('listing_watch_seen')
        .upsert(toInsert, { onConflict: 'listing_id', ignoreDuplicates: true });
      if (insErr) console.error(`    seen-insert error: ${insErr.message}`);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`Done. ${totalNew} new listing(s), ${totalAlerted} alerted.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
