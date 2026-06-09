import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isHiddenByFields } from '@/lib/card-visibility'
import type { SupabaseClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const all: T[] = []
  const PAGE = 1000
  for (let f = 0; ; f += PAGE) {
    const { data } = await build(f, f + PAGE - 1)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
  }
  return all
}

/** Sales coverage scoped to the REAL scrape universe: products mapped from
 *  cards the site shows. The full tcgplayer_products table (~6k) includes
 *  thousands of hidden-card products we deliberately never scrape, so counting
 *  against it made "scraped (24h)" and "never scraped" meaningless. */
async function computeSalesCoverage(supabase: SupabaseClient, since24h: string) {
  const [cardRows, mapRows, prodRows] = await Promise.all([
    fetchAll<{ id: string; set_id: string; type: string; rarity: string | null; art_style: string | null }>((from, to) =>
      supabase.from('cards').select('id, set_id, type, rarity, art_style').range(from, to)),
    fetchAll<{ card_id: string; tcgplayer_product_id: number }>((from, to) =>
      supabase.from('card_tcgplayer_mapping').select('card_id, tcgplayer_product_id').range(from, to)),
    fetchAll<{ product_id: number; sales_scraped_at: string | null }>((from, to) =>
      supabase.from('tcgplayer_products').select('product_id, sales_scraped_at').range(from, to)),
  ])

  const visibleCardIds = new Set<string>()
  for (const c of cardRows) {
    if (!isHiddenByFields(c.set_id, c.type, c.rarity, c.art_style)) visibleCardIds.add(c.id)
  }
  const universe = new Set<number>()
  for (const m of mapRows) {
    if (visibleCardIds.has(m.card_id)) universe.add(m.tcgplayer_product_id)
  }

  let scrapedLast24h = 0
  let neverScraped = 0
  let oldestScrapedAt: string | null = null
  for (const p of prodRows) {
    if (!universe.has(p.product_id)) continue
    if (p.sales_scraped_at == null) { neverScraped++; continue }
    if (p.sales_scraped_at > since24h) scrapedLast24h++
    if (oldestScrapedAt == null || p.sales_scraped_at < oldestScrapedAt) oldestScrapedAt = p.sales_scraped_at
  }

  const totalProducts = universe.size
  // Days to cover the whole universe at the last-24h throughput. Tells you at a
  // glance whether the rotation actually cycles the list (and how the cadence
  // throttling hurts) — full coverage in 24h is NOT expected at low run rates.
  const cycleDays = scrapedLast24h > 0 ? totalProducts / scrapedLast24h : null

  return { totalProducts, scrapedLast24h, neverScraped, oldestScrapedAt, cycleDays }
}

/** Aggregated scraper health for the Admin → Scraper HQ master view:
 *  per-job last run, price/sales freshness, per-set coverage, token health,
 *  and recent run history. Admin-gated; never returns the raw auth cookie. */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const [
    pricesRunRes,
    salesRunRes,
    recentRunsRes,
    latestPriceRes,
    coverage,
    setsRes,
    cookieRes,
    ghTokenRes,
  ] = await Promise.all([
    supabase.from('scraper_runs').select('*').in('job_type', ['prices', 'both']).order('started_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('scraper_runs').select('*').in('job_type', ['sales', 'both']).order('started_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('scraper_runs').select('id, job_type, trigger, status, error_code, error, stats, log_url, started_at, finished_at').order('started_at', { ascending: false }).limit(20),
    supabase.from('tcgplayer_card_price_history').select('recorded_date').order('recorded_date', { ascending: false }).limit(1).maybeSingle(),
    computeSalesCoverage(supabase, since24h),
    supabase.from('scraper_set_status').select('*').order('release_date', { ascending: false }),
    supabase.from('scraper_settings').select('updated_at').eq('key', 'tcgplayer_auth_cookie').maybeSingle(),
    supabase.from('scraper_settings').select('updated_at').eq('key', 'github_token').maybeSingle(),
  ])

  // Rows written on the latest price date (a coarse "did the price job land" check).
  const latestPriceDate = latestPriceRes.data?.recorded_date ?? null
  let rowsOnLatestPriceDate = 0
  if (latestPriceDate) {
    const { count } = await supabase
      .from('tcgplayer_card_price_history')
      .select('*', { count: 'exact', head: true })
      .eq('recorded_date', latestPriceDate)
    rowsOnLatestPriceDate = count ?? 0
  }

  // Token health, inferred from the most recent sales-bearing run.
  const salesRun = salesRunRes.data
  const dbCookie = !!cookieRes.data
  let tokenHealth: 'valid' | 'expired' | 'anon' | 'unknown' = 'unknown'
  if (salesRun?.error_code === 'auth_expired') tokenHealth = 'expired'
  else if (salesRun?.stats?.fetch?.authedPages > 0) tokenHealth = 'valid'
  else if (salesRun && salesRun.stats?.fetch?.ok > 0 && !salesRun.stats?.fetch?.authedPages) tokenHealth = 'anon'

  return NextResponse.json({
    token: {
      source: dbCookie ? 'db' : 'secret',
      dbUpdatedAt: cookieRes.data?.updated_at ?? null,
      health: tokenHealth,
    },
    jobs: {
      prices: pricesRunRes.data ?? null,
      sales: salesRunRes.data ?? null,
    },
    priceFreshness: { latestDate: latestPriceDate, rowsOnLatest: rowsOnLatestPriceDate },
    salesCoverage: coverage,
    triggers: {
      githubTokenSet: !!ghTokenRes.data,
      repo: process.env.GITHUB_DISPATCH_REPO ?? 'dankshi/op-cardlist',
      ref: process.env.GITHUB_DISPATCH_REF ?? 'nomi',
    },
    sets: setsRes.data ?? [],
    recentRuns: recentRunsRes.data ?? [],
  })
}
