import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

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
    totalProductsRes,
    scraped24hRes,
    neverScrapedRes,
    oldestScrapedRes,
    setsRes,
    cookieRes,
    ghTokenRes,
  ] = await Promise.all([
    supabase.from('scraper_runs').select('*').in('job_type', ['prices', 'both']).order('started_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('scraper_runs').select('*').in('job_type', ['sales', 'both']).order('started_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('scraper_runs').select('id, job_type, trigger, status, error_code, error, stats, log_url, started_at, finished_at').order('started_at', { ascending: false }).limit(20),
    supabase.from('tcgplayer_card_price_history').select('recorded_date').order('recorded_date', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('tcgplayer_products').select('*', { count: 'exact', head: true }),
    supabase.from('tcgplayer_products').select('*', { count: 'exact', head: true }).gt('sales_scraped_at', since24h),
    supabase.from('tcgplayer_products').select('*', { count: 'exact', head: true }).is('sales_scraped_at', null),
    supabase.from('tcgplayer_products').select('sales_scraped_at').not('sales_scraped_at', 'is', null).order('sales_scraped_at', { ascending: true }).limit(1).maybeSingle(),
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
    salesCoverage: {
      totalProducts: totalProductsRes.count ?? 0,
      scrapedLast24h: scraped24hRes.count ?? 0,
      neverScraped: neverScrapedRes.count ?? 0,
      oldestScrapedAt: oldestScrapedRes.data?.sales_scraped_at ?? null,
    },
    triggers: {
      githubTokenSet: !!ghTokenRes.data,
      repo: process.env.GITHUB_DISPATCH_REPO ?? 'dankshi/op-cardlist',
      ref: process.env.GITHUB_DISPATCH_REF ?? 'nomi',
    },
    sets: setsRes.data ?? [],
    recentRuns: recentRunsRes.data ?? [],
  })
}
