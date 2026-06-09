'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { OnboardingSection } from '@/components/admin/scraper/OnboardingSection'

interface RunRow {
  id: number
  job_type: string
  trigger: string
  status: 'running' | 'success' | 'partial' | 'failed'
  error_code: string | null
  error: string | null
  stats: {
    durationMs?: number
    salesStored?: number
    productsWithSales?: number
    fetch?: { ok?: number; authedPages?: number; giveUp?: number; rateLimited?: number; pagesWith25?: number }
    cards?: { cardId: string; productId: number; sales: number }[]
  } | null
  log_url: string | null
  started_at: string
  finished_at: string | null
}

interface Status {
  token: { source: string; dbUpdatedAt: string | null; health: 'valid' | 'expired' | 'anon' | 'unknown' }
  jobs: { prices: RunRow | null; sales: RunRow | null }
  priceFreshness: { latestDate: string | null; rowsOnLatest: number }
  salesCoverage: { totalProducts: number; scrapedLast24h: number; neverScraped: number; oldestScrapedAt: string | null; cycleDays: number | null }
  triggers: { githubTokenSet: boolean; repo: string; ref: string }
  sets: { set_id: string; name: string; release_date: string | null; last_scraped_at: string | null; total_cards: number; mapped_cards: number }[]
  recentRuns: RunRow[]
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—'
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
function fmtDur(ms?: number): string {
  if (!ms) return '—'
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

const STATUS_STYLE: Record<string, string> = {
  success: 'bg-emerald-100 text-emerald-800',
  partial: 'bg-amber-100 text-amber-800',
  failed: 'bg-red-100 text-red-800',
  running: 'bg-blue-100 text-blue-800',
}
function StatusPill({ s }: { s: string }) {
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${STATUS_STYLE[s] ?? 'bg-zinc-100 text-zinc-600'}`}>{s}</span>
}

export default function ScraperHqPage() {
  const [data, setData] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [cookie, setCookie] = useState('')
  const [savingToken, setSavingToken] = useState(false)
  const [tokenMsg, setTokenMsg] = useState<string | null>(null)
  const [scrapeCardId, setScrapeCardId] = useState('')
  const [scraping, setScraping] = useState(false)
  const [scrapeMsg, setScrapeMsg] = useState<string | null>(null)
  const [triggering, setTriggering] = useState<string | null>(null)
  const [triggerMsg, setTriggerMsg] = useState<string | null>(null)
  const [ghToken, setGhToken] = useState('')
  const [savingGh, setSavingGh] = useState(false)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  function toggleRun(id: number) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/scraper-hq/status')
    if (res.ok) setData(await res.json())
    setLoading(false)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  async function saveToken() {
    if (!cookie.trim()) return
    setSavingToken(true)
    setTokenMsg(null)
    const res = await fetch('/api/admin/scraper-hq/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie }),
    })
    setSavingToken(false)
    if (res.ok) {
      setTokenMsg('Saved — the next sales run (within ~5 min) will use it.')
      setCookie('')
      load()
    } else {
      const b = await res.json().catch(() => ({}))
      setTokenMsg(b.error || 'Failed to save.')
    }
  }

  async function scrapeCard() {
    if (!scrapeCardId.trim()) return
    setScraping(true)
    setScrapeMsg(null)
    const res = await fetch('/api/admin/scraper-hq/scrape-card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId: scrapeCardId }),
    })
    const b = await res.json().catch(() => ({}))
    setScraping(false)
    if (res.ok) {
      setScrapeMsg(`✓ Stored ${b.salesStored} sales for ${b.cardId}${b.lastSold ? ` · last sold $${b.lastSold.price} on ${new Date(b.lastSold.date).toLocaleDateString()}` : ' (no recent sales)'}`)
      load()
    } else {
      setScrapeMsg(b.error || 'Scrape failed.')
    }
  }

  async function runJob(job: 'prices' | 'sales') {
    setTriggering(job)
    setTriggerMsg(null)
    const res = await fetch('/api/admin/scraper-hq/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job }),
    })
    const b = await res.json().catch(() => ({}))
    setTriggering(null)
    setTriggerMsg(res.ok ? `✓ Triggered ${job} — it'll appear in Recent runs shortly.` : (b.error || 'Failed to trigger.'))
    if (res.ok) setTimeout(load, 4000)
  }

  async function saveGhToken() {
    if (!ghToken.trim()) return
    setSavingGh(true)
    setTriggerMsg(null)
    const res = await fetch('/api/admin/scraper-hq/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'github_token', value: ghToken }),
    })
    setSavingGh(false)
    if (res.ok) { setGhToken(''); setTriggerMsg('✓ GitHub token saved.'); load() }
    else { const b = await res.json().catch(() => ({})); setTriggerMsg(b.error || 'Failed to save.') }
  }

  if (loading) {
    return <div className="py-20 text-center"><div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" /></div>
  }
  if (!data) return <p className="text-sm text-red-600">Failed to load scraper status.</p>

  const tokenBad = data.token.health === 'expired' || data.token.health === 'anon'

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Scraper HQ</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Status of every scraping job — prices, sales, sets, and the TCGplayer token.</p>
        </div>
        <button onClick={() => { setLoading(true); load() }} className="px-3 py-2 rounded-lg text-sm font-semibold text-zinc-700 ring-1 ring-zinc-300 hover:bg-zinc-50 cursor-pointer">Refresh</button>
      </div>

      {/* Token health */}
      <div className={`rounded-xl border p-5 ${tokenBad ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-zinc-900">
            TCGplayer token: {' '}
            <span className={tokenBad ? 'text-red-700' : 'text-emerald-700'}>
              {data.token.health === 'valid' ? 'Valid (deep sales feed)' : data.token.health === 'expired' ? 'Expired — refresh needed' : data.token.health === 'anon' ? 'Anonymous (capped at ~5 sales/card)' : 'Unknown'}
            </span>
          </h2>
          <span className="text-xs text-zinc-500">source: {data.token.source}{data.token.dbUpdatedAt ? ` · updated ${timeAgo(data.token.dbUpdatedAt)}` : ''}</span>
        </div>
        {tokenBad && (
          <div className="mt-3 text-sm text-zinc-700">
            <p className="font-semibold mb-1">How to refresh:</p>
            <ol className="list-decimal ml-5 space-y-0.5 text-[13px]">
              <li>Log out and back in at <span className="font-mono">tcgplayer.com</span>.</li>
              <li>Open DevTools → Application → Cookies → <span className="font-mono">tcgplayer.com</span>.</li>
              <li>Copy the value of <span className="font-mono">TCGAuthTicket_Production</span> (you can paste the whole cookie; we&rsquo;ll extract it).</li>
              <li>Paste below and save — the next sales run picks it up automatically.</li>
            </ol>
            <div className="mt-3 flex gap-2">
              <input
                type="password"
                value={cookie}
                onChange={e => setCookie(e.target.value)}
                placeholder="Paste TCGAuthTicket_Production…"
                className="flex-1 px-3 py-2 rounded-lg border border-zinc-300 text-sm font-mono text-zinc-900 focus:outline-none focus:border-zinc-500"
              />
              <button onClick={saveToken} disabled={savingToken || !cookie.trim()} className="px-4 py-2 rounded-lg text-sm font-bold bg-zinc-900 text-white hover:bg-zinc-800 cursor-pointer disabled:opacity-50">
                {savingToken ? 'Saving…' : 'Save token'}
              </button>
            </div>
          </div>
        )}
        {tokenMsg && <p className="mt-2 text-sm font-semibold text-emerald-700">{tokenMsg}</p>}
      </div>

      {/* On-demand single-card scrape */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5">
        <h2 className="text-xs font-bold uppercase tracking-wide text-zinc-500 mb-1">Scrape a card now</h2>
        <p className="text-sm text-zinc-500 mb-3">Pull fresh sales for one card immediately — e.g. <span className="font-mono">OP14-084_p1</span>.</p>
        <div className="flex gap-2">
          <input
            value={scrapeCardId}
            onChange={e => setScrapeCardId(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') scrapeCard() }}
            placeholder="Card ID"
            className="flex-1 px-3 py-2 rounded-lg border border-zinc-300 text-sm font-mono text-zinc-900 focus:outline-none focus:border-zinc-500"
          />
          <button onClick={scrapeCard} disabled={scraping || !scrapeCardId.trim()} className="px-4 py-2 rounded-lg text-sm font-bold bg-orange-500 hover:bg-orange-600 text-white cursor-pointer disabled:opacity-50">
            {scraping ? 'Scraping…' : 'Scrape now'}
          </button>
        </div>
        {scrapeMsg && <p className="mt-2 text-sm font-semibold text-zinc-700">{scrapeMsg}</p>}
      </div>

      {/* Run full jobs on demand (GitHub workflow_dispatch) */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5">
        <h2 className="text-xs font-bold uppercase tracking-wide text-zinc-500 mb-1">Run a full job now</h2>
        {data.triggers.githubTokenSet ? (
          <>
            <p className="text-sm text-zinc-500 mb-3">Kicks off the GitHub Actions workflow on <span className="font-mono">{data.triggers.ref}</span>; the run shows up in Recent runs once it starts (~1 min).</p>
            <div className="flex gap-2">
              <button onClick={() => runJob('prices')} disabled={!!triggering} className="px-4 py-2 rounded-lg text-sm font-bold bg-zinc-900 text-white hover:bg-zinc-800 cursor-pointer disabled:opacity-50">{triggering === 'prices' ? 'Triggering…' : 'Run prices now'}</button>
              <button onClick={() => runJob('sales')} disabled={!!triggering} className="px-4 py-2 rounded-lg text-sm font-bold bg-zinc-900 text-white hover:bg-zinc-800 cursor-pointer disabled:opacity-50">{triggering === 'sales' ? 'Triggering…' : 'Run sales now'}</button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-zinc-500 mb-2">Add a GitHub token (fine-grained, <span className="font-mono">Actions: write</span> on <span className="font-mono">{data.triggers.repo}</span>) to enable one-click job runs.</p>
            <div className="flex gap-2">
              <input type="password" value={ghToken} onChange={e => setGhToken(e.target.value)} placeholder="github_pat_…" className="flex-1 px-3 py-2 rounded-lg border border-zinc-300 text-sm font-mono text-zinc-900 focus:outline-none focus:border-zinc-500" />
              <button onClick={saveGhToken} disabled={savingGh || !ghToken.trim()} className="px-4 py-2 rounded-lg text-sm font-bold bg-zinc-900 text-white hover:bg-zinc-800 cursor-pointer disabled:opacity-50">{savingGh ? 'Saving…' : 'Save token'}</button>
            </div>
          </>
        )}
        {triggerMsg && <p className="mt-2 text-sm font-semibold text-zinc-700">{triggerMsg}</p>}
      </div>

      {/* Daily jobs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <JobCard
          title="Prices"
          cadence="Daily · 06:00 UTC"
          run={data.jobs.prices}
          extra={[
            ['Latest price date', data.priceFreshness.latestDate ?? '—'],
            ['Rows on latest', data.priceFreshness.rowsOnLatest.toLocaleString()],
          ]}
        />
        <JobCard
          title="Sales"
          cadence="Every 5 min · rotating window"
          run={data.jobs.sales}
          extra={[
            ['Scrape universe', data.salesCoverage.totalProducts.toLocaleString()],
            ['Scraped (last 24h)', data.salesCoverage.scrapedLast24h.toLocaleString()],
            ['Full cycle (est)', data.salesCoverage.cycleDays != null
              ? data.salesCoverage.cycleDays < 1
                ? `~${Math.round(data.salesCoverage.cycleDays * 24)}h`
                : `~${data.salesCoverage.cycleDays.toFixed(1)}d`
              : '—'],
            ['Never scraped', data.salesCoverage.neverScraped.toLocaleString()],
            ['Stalest card', timeAgo(data.salesCoverage.oldestScrapedAt)],
          ]}
        />
      </div>

      {/* Recent runs */}
      <div className="rounded-xl border border-zinc-200 bg-white">
        <div className="px-5 py-3 border-b border-zinc-100"><h2 className="text-xs font-bold uppercase tracking-wide text-zinc-500">Recent runs</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-zinc-400 uppercase tracking-wide">
              <th className="px-5 py-2 font-semibold">Job</th>
              <th className="px-3 py-2 font-semibold">Trigger</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">When</th>
              <th className="px-3 py-2 font-semibold">Duration</th>
              <th className="px-3 py-2 font-semibold">Result</th>
              <th className="px-5 py-2 font-semibold">Logs</th>
            </tr></thead>
            <tbody className="divide-y divide-zinc-100">
              {data.recentRuns.map(r => {
                const cards = r.stats?.cards ?? []
                const canExpand = cards.length > 0
                const isOpen = expanded.has(r.id)
                return (
                  <Fragment key={r.id}>
                    <tr className={canExpand ? 'cursor-pointer hover:bg-zinc-50' : ''} onClick={() => canExpand && toggleRun(r.id)}>
                      <td className="px-5 py-2 font-medium text-zinc-900">
                        <span className="inline-block w-3 text-zinc-400 mr-1">{canExpand ? (isOpen ? '▾' : '▸') : ''}</span>
                        {r.job_type}
                      </td>
                      <td className="px-3 py-2 text-zinc-500">{r.trigger}</td>
                      <td className="px-3 py-2"><StatusPill s={r.status} />{r.error_code && <span className="ml-1 text-[10px] text-red-600">{r.error_code}</span>}</td>
                      <td className="px-3 py-2 text-zinc-500">{timeAgo(r.started_at)}</td>
                      <td className="px-3 py-2 text-zinc-500 tabular-nums">{fmtDur(r.stats?.durationMs)}</td>
                      <td className="px-3 py-2 text-zinc-500 tabular-nums">
                        {r.stats?.salesStored != null ? `${r.stats.salesStored} sales` : ''}
                        {canExpand ? <span className="text-zinc-400"> · {cards.length} cards</span> : ''}
                        {r.stats?.fetch?.giveUp ? <span className="text-amber-600"> · {r.stats.fetch.giveUp} gave up</span> : ''}
                      </td>
                      <td className="px-5 py-2">{r.log_url ? <a href={r.log_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-indigo-600 hover:underline">view</a> : '—'}</td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-zinc-50/60">
                        <td colSpan={7} className="px-5 py-3">
                          <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
                            {cards.map(c => (
                              <span key={c.cardId} className="inline-flex items-center gap-1.5">
                                <Link href={`/card/${c.cardId.toLowerCase()}`} target="_blank" className="font-mono font-semibold text-indigo-600 hover:underline">{c.cardId}</Link>
                                <span className="text-zinc-400 tabular-nums">{c.sales} sales</span>
                                <a href={`https://www.tcgplayer.com/product/${c.productId}`} target="_blank" rel="noreferrer" className="text-zinc-300 hover:text-zinc-600" title="TCGplayer product">↗</a>
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {data.recentRuns.length === 0 && <tr><td colSpan={7} className="px-5 py-6 text-center text-zinc-400">No runs recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* New-set onboarding + set coverage — both are manual/rarely-updated set
          concerns, grouped at the bottom away from the live scraper status. */}
      <OnboardingSection />

      {/* Sets coverage */}
      <div className="rounded-xl border border-zinc-200 bg-white">
        <div className="px-5 py-3 border-b border-zinc-100"><h2 className="text-xs font-bold uppercase tracking-wide text-zinc-500">Sets — initial scrape &amp; mapping coverage</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-zinc-400 uppercase tracking-wide">
              <th className="px-5 py-2 font-semibold">Set</th>
              <th className="px-3 py-2 font-semibold">Last scraped</th>
              <th className="px-3 py-2 font-semibold">Cards</th>
              <th className="px-5 py-2 font-semibold">Mapping</th>
            </tr></thead>
            <tbody className="divide-y divide-zinc-100">
              {data.sets.map(s => {
                const pct = s.total_cards > 0 ? Math.round((s.mapped_cards / s.total_cards) * 100) : 0
                const full = s.total_cards > 0 && s.mapped_cards >= s.total_cards
                return (
                  <tr key={s.set_id}>
                    <td className="px-5 py-2 text-zinc-900">{s.name}</td>
                    <td className="px-3 py-2 text-zinc-500">{timeAgo(s.last_scraped_at)}</td>
                    <td className="px-3 py-2 tabular-nums text-zinc-700">{s.total_cards}</td>
                    <td className="px-5 py-2 tabular-nums font-semibold">
                      {full
                        ? <span className="text-emerald-600">✓</span>
                        : <span className={pct >= 60 ? 'text-amber-600' : 'text-red-600'}>{s.mapped_cards}/{s.total_cards} · {pct}%</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* How it works */}
      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600 space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-zinc-500">How the scraper works</h2>
        <p><strong className="text-zinc-800">Sets &amp; cards</strong> are ingested from Bandai&rsquo;s cardlist (manual run per new set), then each card is mapped to a TCGplayer product. The &ldquo;Sets&rdquo; table below shows when each set was last ingested and how much of it is mapped.</p>
        <p><strong className="text-zinc-800">Prices</strong> run once daily (06:00 UTC) and write a market-price snapshot for every mapped product into the price-history table. &ldquo;Latest price date&rdquo; should be today.</p>
        <p><strong className="text-zinc-800">Sales</strong> run every 5 minutes against a small rotating window of the stalest cards (cursor = each product&rsquo;s last sales-scrape time), pulling up to ~90 days of recorded sales per card. The whole catalog cycles roughly every ~11 hours, so any one card refreshes a couple of times a day.</p>
        <p><strong className="text-zinc-800">Token</strong>: the deep sales feed needs a logged-in TCGplayer cookie. If it expires, sales fall back to ~5 per card and the banner above turns red with refresh steps.</p>
      </div>
    </div>
  )
}

function JobCard({ title, cadence, run, extra }: { title: string; cadence: string; run: RunRow | null; extra: [string, string][] }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-bold text-zinc-900">{title}</h2>
          <p className="text-xs text-zinc-400">{cadence}</p>
        </div>
        {run ? <StatusPill s={run.status} /> : <span className="text-xs text-zinc-400">no runs yet</span>}
      </div>
      <dl className="space-y-1.5 text-sm">
        <div className="flex justify-between"><dt className="text-zinc-500">Last run</dt><dd className="text-zinc-900">{run ? timeAgo(run.finished_at ?? run.started_at) : '—'}</dd></div>
        {extra.map(([k, v]) => (
          <div key={k} className="flex justify-between"><dt className="text-zinc-500">{k}</dt><dd className="text-zinc-900 tabular-nums">{v}</dd></div>
        ))}
        {run?.error_code && <div className="flex justify-between"><dt className="text-zinc-500">Issue</dt><dd className="text-red-600 font-semibold">{run.error_code}</dd></div>}
      </dl>
    </div>
  )
}
