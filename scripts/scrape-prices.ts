import * as dotenv from 'dotenv';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Card, CardSet, CardDatabase, CardType, CardColor, Rarity, Attribute, ArtStyle } from '../src/types/card';
import { SET_NAME_MAP } from '../src/lib/set-names';
import { parseSale } from '../src/lib/scraper/tcgplayer-sales';
import { isHiddenByFields } from '../src/lib/card-visibility';

dotenv.config({ path: '.env.local' });

const TCGPLAYER_SEARCH_URL = 'https://mp-search-api.tcgplayer.com/v1/search/request';

// Count of database write errors across the whole run. Supabase upsert/update
// errors are logged but not thrown (so one bad batch doesn't abort the rest),
// then tallied here and turned into a non-zero exit at the end of main(). This
// is what makes a schema break — e.g. a dropped/renamed table — fail the nightly
// job LOUDLY instead of exiting 0. (A silent card_prices write to a dropped
// table is exactly what froze prices site-wide for ~12 days in May 2026.)
let dbWriteErrors = 0;

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

// Internal art style type for more precise matching
type InternalArtStyle = 'standard' | 'alternate' | 'manga' | 'super' | 'red-super' | 'wanted' | 'treasure' | 'reprint' | 'jolly-roger' | 'full-art';

// Sets where cards are reprints (variant naming doesn't follow standard booster conventions)
const REPRINT_SETS = new Set(['prb-01']);

// Categorize TCGPlayer product names into art styles
function getArtStyleFromName(productName: string): InternalArtStyle {
  const lower = productName.toLowerCase();

  if (lower.includes('red super alternate')) return 'red-super';
  if (lower.includes('super alternate') || lower.includes('super alt')) return 'super';
  if (lower.includes('wanted') || lower.includes('wanted poster')) return 'wanted';
  if (lower.includes('manga')) return 'manga';
  if (lower.includes('treasure') || lower.includes('treasure cup') || lower.includes('box topper')) return 'treasure';
  if (lower.includes('full art')) return 'full-art';
  if (lower.includes('jolly roger')) return 'jolly-roger';
  if (lower.includes('alternate art') || lower.includes('alt art') || lower.includes('parallel') || lower.includes('art variant')) return 'alternate';
  if (lower.includes('reprint')) return 'reprint';

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

  // Find best match by art style
  let result: TCGPlayerProduct | undefined;

  // Reprint sets (PRB-01, etc.) use different variant naming than standard boosters
  if (REPRINT_SETS.has(card.setId)) {
    if (!card.isParallel) {
      // Non-parallel: prefer standard or reprint
      result = matchingProducts.find((p) => getArtStyleFromName(p.productName) === 'standard');
      if (!result) {
        result = matchingProducts.find((p) => getArtStyleFromName(p.productName) === 'reprint');
      }
    } else {
      // Parallel cards: match by card's artStyle field
      if (card.artStyle === 'manga') {
        result = matchingProducts.find((p) => getArtStyleFromName(p.productName) === 'manga');
      }
      if (!result) {
        result = matchingProducts.find((p) => getArtStyleFromName(p.productName) === 'alternate');
      }
      if (!result) {
        result = matchingProducts.find((p) => getArtStyleFromName(p.productName) === 'full-art');
      }
      if (!result) {
        result = matchingProducts.find((p) => getArtStyleFromName(p.productName) === 'jolly-roger');
      }
      if (!result) {
        result = matchingProducts.find((p) => !['standard', 'reprint'].includes(getArtStyleFromName(p.productName)));
      }
    }
    // Final fallback for reprint sets
    if (!result) {
      result = matchingProducts[0];
    }
  } else {
    // Standard booster set matching
    const expectedStyle = getExpectedArtStyle(card);

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
  }

  if (debug && result) {
    console.log(`    Selected: ${result.productName}`);
  }

  return result || null;
}

interface SaleRecord {
  price: number;
  date: string;
  condition: string | null;
  variant: string | null;
  language: string | null;
  listingType: string | null;
  shippingPrice: number | null;
  customListingId: string | null;
  quantity: number;
}

// Module-level counters so the caller can surface rate-limit pressure at the end.
const fetchStats = {
  ok: 0,
  rateLimited: 0,
  giveUp: 0,
  error: 0,
  // Cookie health: did we ever hit a "looks like an authed response" page?
  authedPages: 0,
  pagesWith25: 0,    // signal that auth is working — anon caps at 5
};

type FetchPage =
  | { kind: 'ok'; sales: SaleRecord[]; hasMore: boolean; totalResults: number }
  | { kind: 'rate_limited' }
  | { kind: 'error'; message: string };

// The TCGplayer auth cookie. Defaults to the env/GitHub-secret value, but
// main() overrides it from the scraper_settings table when a service-role
// client is available — so admins can refresh it from the Scraper HQ without
// touching CI secrets.
let authCookie: string | undefined = process.env.TCGPLAYER_AUTH_COOKIE;
const PAGE_SIZE = 25;
// Cap at 6 pages (150 sales) per product. Covers 90 days for nearly every card
// and limits how far we paginate on the rare high-volume chase card.
const MAX_PAGES_PER_PRODUCT = 6;
const CUTOFF_DAYS = 90;
// Polite per-page delay inside a product's pagination loop. A real seller
// scrolling the Sales History modal would have a similar gap between page-2
// and page-3 fetches.
const INTER_PAGE_DELAY_MS = [400, 900];

async function fetchSalesPage(
  productId: number,
  offset: number,
  snapshotTime: number,
): Promise<FetchPage> {
  try {
    const res = await fetch(`https://mpapi.tcgplayer.com/v2/product/${productId}/latestsales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Origin': 'https://www.tcgplayer.com',
        'Referer': 'https://www.tcgplayer.com/',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
        ...(authCookie
          ? { Cookie: `TCGAuthTicket_Production=${authCookie}` }
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

    if (res.status === 429 || res.status === 403) return { kind: 'rate_limited' };
    if (!res.ok) return { kind: 'error', message: `HTTP ${res.status}` };

    const text = await res.text();
    if (text.startsWith('<')) return { kind: 'rate_limited' };

    const data = JSON.parse(text);
    const sales = data.data;
    if (!Array.isArray(sales)) return { kind: 'error', message: 'unexpected response shape' };

    return {
      kind: 'ok',
      sales: sales.map(parseSale),
      hasMore: data.nextPage === 'Yes',
      totalResults: Number(data.totalResults ?? sales.length),
    };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

// Single attempt wrapped in exponential-backoff retry on rate-limit / 403.
async function fetchSalesPageWithRetry(
  productId: number,
  offset: number,
  snapshotTime: number,
): Promise<FetchPage> {
  const MAX_ATTEMPTS = 4;
  let backoffMs = 2000;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await fetchSalesPage(productId, offset, snapshotTime);
    if (result.kind === 'ok' || result.kind === 'error') return result;
    // rate_limited
    fetchStats.rateLimited++;
    if (attempt === MAX_ATTEMPTS) {
      fetchStats.giveUp++;
      return { kind: 'rate_limited' };
    }
    const jitter = Math.random() * 1000;
    await sleep(backoffMs + jitter);
    backoffMs *= 2;
  }
  return { kind: 'rate_limited' };
}

// Paginated fetch — walks pages until no more, hits MAX_PAGES, or sales reach
// the 90-day cutoff. Returns [] on persistent failure.
async function fetchSales(productId: number): Promise<SaleRecord[]> {
  const all: SaleRecord[] = [];
  const snapshotTime = Date.now();
  const cutoff = Date.now() - CUTOFF_DAYS * 86_400_000;

  for (let page = 0; page < MAX_PAGES_PER_PRODUCT; page++) {
    if (page > 0) {
      const [lo, hi] = INTER_PAGE_DELAY_MS;
      await sleep(lo + Math.random() * (hi - lo));
    }
    const offset = page * PAGE_SIZE;
    const result = await fetchSalesPageWithRetry(productId, offset, snapshotTime);

    if (result.kind !== 'ok') {
      if (result.kind === 'error' && fetchStats.error <= 5) {
        console.warn(`  ⚠ fetchSales(${productId}): ${result.message}`);
      }
      if (result.kind === 'error') fetchStats.error++;
      // On rate-limit we return what we already have rather than nothing.
      return all;
    }

    fetchStats.ok++;
    if (result.sales.length === PAGE_SIZE) fetchStats.pagesWith25++;
    if (authCookie && result.totalResults > 5) fetchStats.authedPages++;

    all.push(...result.sales);

    // Stop if no next page, or oldest sale on this page is older than cutoff.
    const oldest = result.sales[result.sales.length - 1];
    const oldestMs = oldest ? new Date(oldest.date).getTime() : Infinity;
    if (!result.hasMore || oldestMs < cutoff) break;
  }

  return all;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Set of card ids the site hides (and so we must not scrape). Used by the
// sales-only path, which loads mappings directly and never builds the card DB.
async function loadHiddenCardIds(supabase: SupabaseClient): Promise<Set<string>> {
  const hidden = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('cards')
      .select('id, set_id, type, rarity, art_style')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`hidden-card load: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data) {
      if (isHiddenByFields(r.set_id as string, r.type as string, r.rarity as string, r.art_style as string)) {
        hidden.add(r.id as string);
      }
    }
    if (data.length < PAGE) break;
  }
  return hidden;
}

async function loadCardDatabaseFromSupabase(supabase: SupabaseClient): Promise<CardDatabase> {
  // Pull all sets + all cards from the DB and reassemble the CardDatabase
  // shape the rest of this script expects. Paginate cards to defeat the
  // 1000-row default cap.
  const { data: setRows, error: setErr } = await supabase
    .from('card_sets')
    .select('*')
    .order('release_date', { ascending: false });
  if (setErr) throw new Error(`card_sets fetch: ${setErr.message}`);

  const cardRows: Record<string, unknown>[] = [];
  const PAGE = 1000;
  for (let f = 0; ; f += PAGE) {
    const { data, error } = await supabase.from('cards').select('*').order('id').range(f, f + PAGE - 1);
    if (error) throw new Error(`cards fetch (offset ${f}): ${error.message}`);
    if (!data || data.length === 0) break;
    cardRows.push(...data);
    if (data.length < PAGE) break;
  }

  const cardsBySet = new Map<string, Card[]>();
  let hiddenSkipped = 0;
  for (const row of cardRows) {
    // Don't scrape cards the site never shows (low-rarity standard prints, etc).
    // Same predicate the storefront uses — see src/lib/card-visibility.
    if (isHiddenByFields(row.set_id as string, row.type as string, row.rarity as string, row.art_style as string)) {
      hiddenSkipped++;
      continue;
    }
    const card: Card = {
      id: row.id as string,
      baseId: row.base_id as string,
      name: row.name as string,
      type: (row.type as CardType) ?? 'CHARACTER',
      colors: (row.colors as CardColor[]) ?? [],
      rarity: (row.rarity as Rarity) ?? 'C',
      cost: (row.cost as number) ?? null,
      power: (row.power as number) ?? null,
      counter: (row.counter as number) ?? null,
      life: (row.life as number) ?? null,
      attribute: (row.attribute as Attribute) ?? null,
      traits: (row.traits as string[]) ?? [],
      effect: (row.effect as string) ?? '',
      trigger: (row.trigger_text as string) ?? null,
      imageUrl: (row.image_url as string) ?? '',
      setId: row.set_id as string,
      variant: (row.variant as string) ?? undefined,
      // Derived from variant. The DB no longer carries a separate
      // is_parallel column — variant suffix on the ID is the signal.
      isParallel: row.variant != null,
      artStyle: (row.art_style as ArtStyle) ?? 'standard',
    };
    const list = cardsBySet.get(card.setId);
    if (list) list.push(card);
    else cardsBySet.set(card.setId, [card]);
  }

  if (hiddenSkipped > 0) console.log(`  Skipped ${hiddenSkipped} hidden cards (not shown on site, not scraped)`);

  const sets: CardSet[] = (setRows ?? []).map((s: Record<string, unknown>) => ({
    id: s.id as string,
    name: s.name as string,
    seriesId: (s.series_id as string) ?? '',
    releaseDate: (s.release_date as string) ?? '',
    cardCount: (s.card_count as number) ?? 0,
    cards: cardsBySet.get(s.id as string) ?? [],
  }));

  return { sets, lastUpdated: new Date().toISOString() };
}

// Service-role client + current run id for the scraper_runs audit trail.
// Run-logging and DB-backed auth cookie need the service role (the locked-down
// tables aren't anon-accessible); without it the scraper still works, it just
// doesn't record runs or self-serve the cookie.
let adminClient: SupabaseClient | null = null;
let currentRunId: number | null = null;

async function startRun(jobType: string, scope: Record<string, unknown>): Promise<void> {
  if (!adminClient) return;
  // Trigger label, most-specific first:
  //  - TRIGGER_SOURCE (workflow_dispatch input): 'cron' = Supabase pg_cron
  //    5-min schedule, 'manual' = HQ "Run now" button.
  //  - GITHUB_EVENT_NAME 'schedule' = GitHub's own throttled cron (fallback).
  //  - else a local dev run.
  const src = process.env.TRIGGER_SOURCE?.trim();
  const trigger = src
    ? src
    : process.env.GITHUB_EVENT_NAME
      ? (process.env.GITHUB_EVENT_NAME === 'schedule' ? 'github-cron' : 'manual')
      : 'local';
  const logUrl =
    process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null;
  const { data, error } = await adminClient
    .from('scraper_runs')
    .insert({ job_type: jobType, trigger, scope, status: 'running', log_url: logUrl })
    .select('id')
    .single();
  if (error) {
    console.warn(`  (run-logging disabled: ${error.message})`);
    return;
  }
  currentRunId = data.id as number;
}

// Fire-and-forget Discord ping for each run. Gated purely on DISCORD_WEBHOOK_URL
// being present, which it only is for the sales workflow (the secret isn't wired
// into update-prices.yml) — so prices stays silent without any phase branching.
// A webhook failure must never break the scrape, hence the swallowed catch.
async function notifyDiscord(
  status: 'success' | 'partial' | 'failed',
  patch: { error?: string | null; error_code?: string | null; stats?: Record<string, unknown> },
): Promise<void> {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return;
  const stats = (patch.stats ?? {}) as Record<string, number>;
  const phase = process.env.SCRAPE_PHASE ?? 'both';
  const color = status === 'success' ? 0x2ecc71 : status === 'partial' ? 0xf1c40f : 0xe74c3c;
  const runUrl =
    process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null;
  const durationS = stats.durationMs ? `${(stats.durationMs / 1000).toFixed(1)}s` : '—';
  const fields = [
    { name: 'Status', value: status, inline: true },
    { name: 'Duration', value: durationS, inline: true },
  ];
  // 'Processed' counts the price-scrape pass, which is skipped on sales-only
  // runs (so it's always 0 there). Only show it when it's actually meaningful.
  if (Number(stats.totalProcessed) > 0) {
    fields.push({ name: 'Processed', value: String(stats.totalProcessed), inline: true });
  }
  fields.push(
    { name: 'Cards scraped', value: String(stats.productsScraped ?? '—'), inline: true },
    { name: 'Sales stored', value: String(stats.salesStored ?? '—'), inline: true },
  );
  // List the actual cards scraped (id + sales found), capped to Discord's
  // 1024-char field limit so a big window doesn't get the message rejected.
  const scraped = (patch.stats?.cards ?? []) as { cardId: string; sales: number }[];
  if (scraped.length > 0) {
    const parts: string[] = [];
    let used = 0;
    let shown = 0;
    for (const c of scraped) {
      const piece = `${c.cardId} (${c.sales})`;
      if (used + piece.length + 2 > 950) break; // leave room for the "+N more" tail
      parts.push(piece);
      used += piece.length + 2;
      shown++;
    }
    const tail = shown < scraped.length ? ` …+${scraped.length - shown} more` : '';
    fields.push({ name: `Cards (${scraped.length})`, value: parts.join(', ') + tail, inline: false });
  }
  if (patch.error) fields.push({ name: 'Error', value: String(patch.error).slice(0, 1000), inline: false });
  if (patch.error_code) fields.push({ name: 'Error code', value: patch.error_code, inline: true });
  const body = {
    embeds: [
      {
        title: `Scraper · ${phase} · ${status}`,
        url: runUrl ?? undefined,
        color,
        fields,
        timestamp: new Date().toISOString(),
      },
    ],
  };
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.warn(`  (discord notify failed: ${(err as Error).message})`);
  }
}

async function finishRun(
  status: 'success' | 'partial' | 'failed',
  patch: { error?: string | null; error_code?: string | null; stats?: Record<string, unknown> } = {},
): Promise<void> {
  await notifyDiscord(status, patch);
  if (!adminClient || currentRunId == null) return;
  await adminClient
    .from('scraper_runs')
    .update({ status, finished_at: new Date().toISOString(), ...patch })
    .eq('id', currentRunId);
}

async function main() {
  // Connect to Supabase (required)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  console.log('Connected to Supabase');

  // Service-role client for the locked-down HQ tables (run log + auth cookie).
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    adminClient = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);
    // Prefer the DB-managed cookie (admin-refreshable) over the env secret.
    const { data: cookieRow } = await adminClient
      .from('scraper_settings')
      .select('value')
      .eq('key', 'tcgplayer_auth_cookie')
      .maybeSingle();
    if (cookieRow?.value) {
      authCookie = cookieRow.value as string;
      console.log('Auth cookie: loaded from scraper_settings (DB).');
    }
  }

  console.log('Loading card catalog from cards + card_sets tables...');
  const database = await loadCardDatabaseFromSupabase(supabase);
  console.log(`Loaded ${database.sets.length} sets, ${database.sets.reduce((s, set) => s + set.cards.length, 0)} cards.`);

  // Fetch existing card_id → tcgplayer_product_id mappings from
  // card_tcgplayer_mapping — the single source of truth for the card↔product
  // link (the old card_prices / tcgplayer_card_prices tables were dropped in
  // migration 20260537). ALL mappings here are protected: the price scraper
  // never changes them (that's auto-map-tcgplayer.ts's job); it only refreshes
  // prices into tcgplayer_card_price_history.
  const manualMappings = new Map<string, number>(); // card_id → tcgplayer_product_id
  {
    const PAGE = 1000;
    const all: { card_id: string; tcgplayer_product_id: number | null; source: string }[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('card_tcgplayer_mapping')
        .select('card_id, tcgplayer_product_id, source')
        .order('card_id')
        .range(from, from + PAGE - 1);
      if (error) {
        console.error('Error fetching card_tcgplayer_mapping:', error);
        break;
      }
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < PAGE) break;
    }
    for (const row of all) {
      if (row.tcgplayer_product_id) {
        manualMappings.set(row.card_id, row.tcgplayer_product_id);
      }
    }
    console.log(`Loaded ${manualMappings.size} card_tcgplayer_mapping rows (product IDs protected from scraper rewrite)`);
  }

  const args = process.argv.slice(2);
  const setFilter = args.find(a => a.startsWith('--set='))?.split('=')[1];
  const cardFilter = args.find(a => a.startsWith('--card='))?.split('=')[1];
  const debug = args.includes('--debug');
  const listSets = args.includes('--list-sets');
  // Phase control for split scheduling: 'prices' runs the daily price scrape
  // only (fast, no rate-limit); 'sales' runs ONLY the sales rotation against
  // existing mappings (small frequent windows dodge TCGPlayer's burst limit);
  // 'both' (default) is the original all-in-one behaviour.
  const phase = (process.env.SCRAPE_PHASE ?? 'both') as 'prices' | 'sales' | 'both';

  // DB-registered TCGplayer slugs supplement the in-code SET_NAME_MAP so a
  // freshly onboarded/promoted set is priced without a code change.
  const dbSlugs = new Map<string, string[]>();
  {
    const { data } = await supabase.from('set_tcgplayer_slugs').select('set_id, slugs');
    for (const r of data ?? []) if (Array.isArray(r.slugs) && r.slugs.length) dbSlugs.set(r.set_id as string, r.slugs as string[]);
  }
  const slugsFor = (setId: string): string[] | undefined => SET_NAME_MAP[setId] ?? dbSlugs.get(setId);

  if (listSets) {
    console.log('Available sets and their TCGPlayer mappings:');
    for (const set of database.sets) {
      const tcgNames = slugsFor(set.id) || ['UNMAPPED'];
      console.log(`  ${set.id.padEnd(10)} -> ${tcgNames.join(', ')}`);
    }
    return;
  }

  // Open the run record (no-op without a service-role client).
  await startRun(phase, {
    phase,
    set: setFilter ?? null,
    card: cardFilter ?? null,
    rotation_limit: process.env.SALES_ROTATION_LIMIT ?? null,
  });

  // Count total cards to process
  let totalCards = 0;
  for (const set of database.sets) {
    if (setFilter && set.id !== setFilter) continue;
    if (!slugsFor(set.id)) continue;
    for (const card of set.cards) {
      if (cardFilter && !card.id.toLowerCase().includes(cardFilter.toLowerCase())) continue;
      totalCards++;
    }
  }

  console.log('Starting TCGPlayer price scrape (set-based)...');
  console.log('Writing to: Supabase tcgplayer_card_price_history');
  console.log(`Total cards to process: ${totalCards}`);
  if (setFilter) console.log(`Filtering to set: ${setFilter}`);
  if (cardFilter) console.log(`Filtering to card: ${cardFilter}`);
  if (debug) console.log('Debug mode enabled');

  let totalProcessed = 0;
  let totalFound = 0;
  let totalNotFound = 0;
  let totalManualPreserved = 0;
  // Hoisted to function scope so the final run-record stats can read them
  // (the sales block reassigns these).
  let lastSoldFound = 0;
  let totalSalesStored = 0;
  let salesProductsScraped = 0;
  // Exact cards touched this run (for the HQ run drill-down).
  const scrapedCards: { cardId: string; productId: number; sales: number }[] = [];
  const matchedProductIds: { cardId: string; productId: number }[] = [];
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

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD for history snapshots

  // After the 20260537 consolidation, scrape-prices no longer writes a
  // per-card price row. Current prices live in tcgplayer_card_price_history
  // (keyed by product_id + date) and readers go through the
  // tcgplayer_current_prices view via card_tcgplayer_mapping. We still
  // discover-and-write new mappings (the auto-mapper is canonical, but
  // this is a fallback for sets it hasn't covered yet).
  interface MappingRow {
    card_id: string;
    tcgplayer_product_id: number;
    tcgplayer_url: string;
    tcgplayer_name: string;
    source: 'auto';
  }

  // Skip the whole price scrape in sales-only mode.
  if (phase !== 'sales') for (const set of database.sets) {
    if (setFilter && set.id !== setFilter) continue;

    const tcgSetNames = slugsFor(set.id);
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

    const newMappings: MappingRow[] = [];
    const historyRows: { tcgplayer_product_id: number; recorded_date: string; market_price: number | null; lowest_price: number | null; median_price: number | null; total_listings: number | null }[] = [];

    // Match each of our cards to TCGPlayer products
    for (const card of set.cards) {
      if (cardFilter && !card.id.toLowerCase().includes(cardFilter.toLowerCase())) {
        continue;
      }

      const label = card.isParallel ? `${card.id} (${card.artStyle || card.variant || 'alt'})` : card.id;
      process.stdout.write(`  ${label.padEnd(25)} ${card.name.substring(0, 20).padEnd(20)} `);

      let product: TCGPlayerProduct | null = null;
      let isManual = false;

      // Check if this card has a manually-mapped product ID
      const manualProductId = manualMappings.get(card.id);
      if (manualProductId) {
        // Find the manual product in the set's products to get fresh prices
        product = products.find(p => p.productId === manualProductId) || null;
        isManual = true;

        if (!product) {
          // Manual product not in this set's products — likely a wrong-set
          // mapping. We don't write any history row (no price to record).
          // The next set the scraper hits will see this same product if
          // the mapping is correct after all; otherwise the gap is the
          // visible signal that something needs fixing.
          matchedProductIds.push({ cardId: card.id, productId: manualProductId });
          console.log('[manual, not in set] (skipped — check mapping)');
          totalManualPreserved++;
          totalProcessed++;
          continue;
        }
      }

      if (!product) {
        // Auto-match: find best matching product by card number + art style
        product = findMatchingProduct(card, products, debug);
      }

      if (product) {
        // If this is a fresh discovery (not already in card_tcgplayer_mapping),
        // record the mapping. Existing entries (manual or earlier auto)
        // are left alone — the auto-mapper script is the canonical
        // discovery path; scrape-prices just covers the gap for new sets
        // that haven't been re-auto-mapped yet.
        if (!isManual && !manualMappings.has(card.id)) {
          newMappings.push({
            card_id: card.id,
            tcgplayer_product_id: product.productId,
            tcgplayer_url: `https://www.tcgplayer.com/product/${product.productId}/${product.productUrlName}`,
            tcgplayer_name: product.productName,
            source: 'auto',
          });
        }

        historyRows.push({
          tcgplayer_product_id: product.productId,
          recorded_date: today,
          market_price: product.marketPrice,
          lowest_price: product.lowestPrice,
          median_price: product.medianPrice,
          total_listings: product.totalListings,
        });

        matchedProductIds.push({ cardId: card.id, productId: product.productId });
        const prefix = isManual ? '[manual] ' : '';
        const displayPrice = product.marketPrice?.toFixed(2) || product.lowestPrice?.toFixed(2) || 'N/A';
        console.log(`${prefix}$${displayPrice}`);
        totalFound++;
        if (isManual) totalManualPreserved++;
      } else {
        console.log('--');
        totalNotFound++;
      }

      totalProcessed++;
    }

    // Persist any newly-discovered mappings to card_tcgplayer_mapping.
    // auto-map-tcgplayer.ts is the canonical discovery path; this is a
    // fallback for sets where the auto-mapper hasn't been re-run.
    if (newMappings.length > 0) {
      const { error } = await supabase
        .from('card_tcgplayer_mapping')
        .upsert(newMappings, { onConflict: 'card_id' });
      if (error) {
        console.error(`  Mapping upsert error for ${set.id}:`, error.message);
        dbWriteErrors++;
      } else if (debug) {
        console.log(`  Recorded ${newMappings.length} new mappings`);
      }
    }

    // Snapshot today's prices into history (deduplicate by product ID, keep last seen)
    if (historyRows.length > 0) {
      const uniqueHistory = [...new Map(historyRows.map(r => [r.tcgplayer_product_id, r])).values()];
      const HIST_BATCH = 500;
      for (let i = 0; i < uniqueHistory.length; i += HIST_BATCH) {
        const batch = uniqueHistory.slice(i, i + HIST_BATCH);
        const { error } = await supabase
          .from('tcgplayer_card_price_history')
          .upsert(batch, { onConflict: 'tcgplayer_product_id,recorded_date', ignoreDuplicates: false });
        if (error) {
          console.error(`  History upsert error for ${set.id}:`, error.message);
          dbWriteErrors++;
        }
      }
      if (debug) console.log(`  Saved ${uniqueHistory.length} history rows for ${today}`);
    }
  }

  // Sales-only mode skipped the price scrape, so the product list wasn't
  // built from this run's matches — load it from the existing mappings.
  if (phase === 'sales') {
    // Sales-only mode skips the card-DB load above, so build the hidden-card set
    // straight from the cards table and drop their mappings — otherwise the
    // rotation keeps spending API calls on cards the site never shows. A product
    // mapped from BOTH a hidden and a visible card stays in (the visible card's
    // row keeps it); a product reachable only from hidden cards is dropped.
    const hiddenCardIds = await loadHiddenCardIds(supabase);

    // Paginate — PostgREST caps a single select at 1000 rows, and we have
    // thousands of mappings; without this the rotation would starve every
    // product past the first page.
    const MAP_PAGE = 1000;
    let hiddenMapSkipped = 0;
    for (let from = 0; ; from += MAP_PAGE) {
      const { data: maps } = await supabase
        .from('card_tcgplayer_mapping')
        .select('card_id, tcgplayer_product_id')
        .range(from, from + MAP_PAGE - 1);
      if (!maps || maps.length === 0) break;
      for (const m of maps) {
        if (hiddenCardIds.has(m.card_id as string)) {
          hiddenMapSkipped++;
          continue;
        }
        matchedProductIds.push({ cardId: m.card_id as string, productId: m.tcgplayer_product_id as number });
      }
      if (maps.length < MAP_PAGE) break;
    }
    console.log(
      `Sales-only mode: loaded ${matchedProductIds.length} mapped products (skipped ${hiddenMapSkipped} hidden-card mappings).`,
    );
  }

  // Fetch sales history for matched products on a staleness rotation —
  // touch only the N most-stale products per run so traffic looks natural
  // and we stay under TCGPlayer's anti-bot threshold. Full coverage in
  // ~ceil(matchedProductIds.length / ROTATION_LIMIT) days. Run smaller
  // windows more often (SALES_ROTATION_LIMIT) to spread load and keep sales
  // fresh without tripping rate limits.
  const ROTATION_LIMIT = process.env.SALES_ROTATION_LIMIT
    ? Number(process.env.SALES_ROTATION_LIMIT)
    : process.env.SCRAPE_ALL_PRODUCTS
      ? matchedProductIds.length
      : 300;

  if (phase !== 'prices' && matchedProductIds.length > 0) {
    // Order by sales_scraped_at NULLS FIRST so unseen + stalest products
    // come first. After the 20260537 consolidation, sales_scraped_at lives
    // on tcgplayer_products (keyed by product_id) — the rotation is now
    // product-side, which is the right grain (multiple cards mapped to
    // the same product share one scrape).
    const matchedProdIds = Array.from(new Set(matchedProductIds.map(m => m.productId)));
    const { data: staleness } = await supabase
      .from('tcgplayer_products')
      .select('product_id, sales_scraped_at')
      .in('product_id', matchedProdIds)
      .order('sales_scraped_at', { ascending: true, nullsFirst: true });

    const orderedProducts = new Map(
      (staleness ?? []).map((r, i) => [r.product_id as number, i]),
    );
    matchedProductIds.sort((a, b) => {
      const ia = orderedProducts.get(a.productId) ?? Number.MAX_SAFE_INTEGER;
      const ib = orderedProducts.get(b.productId) ?? Number.MAX_SAFE_INTEGER;
      return ia - ib;
    });

    const targets = matchedProductIds.slice(0, ROTATION_LIMIT);
    salesProductsScraped = targets.length;
    const skipped = matchedProductIds.length - targets.length;
    console.log(
      `\nFetching sales for ${targets.length} stalest products${skipped > 0 ? ` (skipping ${skipped} fresh ones)` : ''}...`,
    );

    lastSoldFound = 0;
    totalSalesStored = 0;
    // last_sold_* and sales_scraped_at live on tcgplayer_products now
    // (keyed by product_id). Multiple cards mapped to the same product
    // share one product-level entry — dedupe on the way in.
    let pendingLastSold: { product_id: number; last_sold_price: number; last_sold_date: string }[] = [];
    let pendingSalesScraped: { product_id: number; sales_scraped_at: string }[] = [];
    let pendingSales: {
      tcgplayer_product_id: number;
      sold_at: string;
      price: number;
      condition: string | null;
      variant: string | null;
      language: string | null;
      listing_type: string | null;
      shipping_price: number | null;
      custom_listing_id: string | null;
      quantity: number;
    }[] = [];
    const FLUSH_SIZE = 500;
    // Lower concurrency for stealth — 2 simultaneous fetches with longer
    // jitter between batches is harder to fingerprint as a bot.
    const batchSize = 2;

    async function flushPending() {
      if (pendingLastSold.length > 0) {
        // Dedupe by product_id (multiple cards may map to the same product;
        // we only want one product row updated per product). UPDATE, not
        // upsert: these products already exist (we just priced them), and a
        // partial-column upsert would try to INSERT {product_id, last_sold_*}
        // with a NULL product_name — Postgres checks that NOT NULL constraint
        // on the proposed insert row before ON CONFLICT can turn it into an
        // UPDATE, so it always fails. (Mirrors the sales_scraped_at block below.)
        const byProduct = new Map(pendingLastSold.map(r => [r.product_id, r]));
        const updates = await Promise.all(
          Array.from(byProduct.values()).map(row =>
            supabase
              .from('tcgplayer_products')
              .update({ last_sold_price: row.last_sold_price, last_sold_date: row.last_sold_date })
              .eq('product_id', row.product_id),
          ),
        );
        const failures = updates.filter(r => r.error);
        if (failures.length > 0) {
          console.error(`  last sold: ${failures.length}/${byProduct.size} updates failed; first error: ${failures[0].error?.message}`);
          dbWriteErrors += failures.length;
        }
        pendingLastSold = [];
      }
      if (pendingSalesScraped.length > 0) {
        // Update sales_scraped_at in parallel so rotation tracking is fast.
        // Dedupe by product_id for the same reason as pendingLastSold.
        const byProduct = new Map(pendingSalesScraped.map(r => [r.product_id, r]));
        const updates = await Promise.all(
          Array.from(byProduct.values()).map(row =>
            supabase
              .from('tcgplayer_products')
              .update({ sales_scraped_at: row.sales_scraped_at })
              .eq('product_id', row.product_id),
          ),
        );
        const failures = updates.filter(r => r.error);
        if (failures.length > 0) {
          console.error(
            `  sales_scraped_at: ${failures.length}/${byProduct.size} updates failed; first error: ${failures[0].error?.message}`,
          );
          dbWriteErrors += failures.length;
        }
        pendingSalesScraped = [];
      }
      if (pendingSales.length > 0) {
        const { error } = await supabase
          .from('card_sales')
          .upsert(pendingSales, {
            onConflict: 'tcgplayer_product_id,sold_at,price,condition,variant,language',
            ignoreDuplicates: true,
          });
        if (error) {
          console.error(`  Supabase card_sales upsert error:`, error.message);
          dbWriteErrors++;
        } else {
          totalSalesStored += pendingSales.length;
        }
        pendingSales = [];
      }
    }

    for (let i = 0; i < targets.length; i += batchSize) {
      const batch = targets.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(({ productId }) => fetchSales(productId))
      );
      const now = new Date().toISOString();
      for (let j = 0; j < batch.length; j++) {
        const { productId } = batch[j];
        const sales = results[j];
        // Always mark as attempted so rotation moves on, even if no sales returned.
        pendingSalesScraped.push({
          product_id: productId,
          sales_scraped_at: now,
        });
        if (scrapedCards.length < 500) {
          scrapedCards.push({ cardId: batch[j].cardId, productId, sales: sales.length });
        }
        if (sales.length > 0) {
          pendingLastSold.push({
            product_id: productId,
            last_sold_price: sales[0].price,
            last_sold_date: sales[0].date,
          });
          lastSoldFound++;

          for (const sale of sales) {
            pendingSales.push({
              tcgplayer_product_id: productId,
              sold_at: sale.date,
              price: sale.price,
              condition: sale.condition,
              variant: sale.variant,
              language: sale.language,
              listing_type: sale.listingType,
              shipping_price: sale.shippingPrice,
              custom_listing_id: sale.customListingId,
              quantity: sale.quantity,
            });
          }
        }
      }

      // Flush to DB every FLUSH_SIZE sales
      if (pendingSales.length >= FLUSH_SIZE) {
        await flushPending();
      }

      if (i % 50 === 0 && i > 0) {
        process.stdout.write(
          `  ${i}/${targets.length} (${totalSalesStored} sales stored, ${fetchStats.rateLimited} 429s)\r`,
        );
      }
      // Polite inter-batch jitter — 2 concurrent × pagination (~3-5 reqs) every
      // 1.5-3s averages out to ~1-2 req/sec, well under any sane rate limit.
      await sleep(1500 + Math.random() * 1500);
    }

    // Flush remaining
    await flushPending();
    console.log(`  Found sales for ${lastSoldFound}/${targets.length} products (${totalSalesStored} total sales stored)`);
    console.log(
      `  fetchSales: ok-pages=${fetchStats.ok}  rate-limited-retries=${fetchStats.rateLimited}  gave-up=${fetchStats.giveUp}  hard-errors=${fetchStats.error}`,
    );
    console.log(
      `  cookie: pages-with-25=${fetchStats.pagesWith25}  authed-pages=${fetchStats.authedPages}  ${authCookie ? '(cookie present)' : '(NO COOKIE — anon mode, capped at 5 sales/product)'}`,
    );
    if (authCookie && fetchStats.authedPages === 0 && fetchStats.ok > 0) {
      console.warn(
        `  ⚠ Cookie is set but every authed response looked anonymous (totalResults <= 5). Cookie has likely expired — refresh TCGPLAYER_AUTH_COOKIE.`,
      );
    }
    if (fetchStats.giveUp > targets.length * 0.05) {
      console.warn(
        `  ⚠ ${fetchStats.giveUp} products gave up after retries — TCGPlayer is rate-limiting hard. Consider lowering ROTATION_LIMIT or running from a residential IP.`,
      );
    }
  }

  const totalTime = formatTime(Date.now() - startTime);

  console.log(`\n✓ Done in ${totalTime}!`);
  console.log(`  Processed: ${totalProcessed}/${totalCards}`);
  console.log(`  Found: ${totalFound} (${((totalFound / totalProcessed) * 100).toFixed(1)}%)`);
  console.log(`  Manual preserved: ${totalManualPreserved}`);
  console.log(`  Not found: ${totalNotFound}`);
  console.log(`  Saved to: Supabase tcgplayer_card_price_history`);

  // Health signals for the run record + HQ.
  const authExpired = !!authCookie && fetchStats.authedPages === 0 && fetchStats.ok > 0;
  const runStats = {
    durationMs: Date.now() - startTime,
    totalCards,
    totalProcessed,
    totalFound,
    totalNotFound,
    totalManualPreserved,
    salesStored: totalSalesStored,
    productsScraped: salesProductsScraped,
    productsWithSales: lastSoldFound,
    fetch: { ...fetchStats },
    dbWriteErrors,
    cards: scrapedCards,
  };

  // Fail the run if any DB write errored. The scraper deliberately logs-and-
  // continues per batch (so one bad row doesn't lose the whole scrape), but a
  // run that couldn't persist its prices must NOT report success — otherwise a
  // schema break (dropped/renamed table or column) shows up as a green nightly
  // job that silently writes nothing.
  if (dbWriteErrors > 0) {
    console.error(`\n✗ ${dbWriteErrors} database write error(s) during this run — exiting non-zero so the schedule surfaces it.`);
    await finishRun('failed', {
      error: `${dbWriteErrors} database write error(s)`,
      error_code: authExpired ? 'auth_expired' : null,
      stats: runStats,
    });
    process.exit(1);
  }

  // Transient rate-limiting (some products give up after retries) is normal for
  // the small rotating sales window — those products just get picked up next
  // rotation, so it does NOT degrade the run. Only an expired auth cookie does.
  await finishRun(authExpired ? 'partial' : 'success', {
    error_code: authExpired ? 'auth_expired' : null,
    stats: runStats,
  });
}

main().catch(async (err) => {
  console.error(err);
  await finishRun('failed', { error: String(err?.message ?? err) });
  process.exit(1);
});
