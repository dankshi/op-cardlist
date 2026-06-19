'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Range, ValuePoint } from '@/lib/collection-history'
import { PortfolioHero } from './PortfolioHero'
import { PortfolioChart } from './PortfolioChart'
import { HoldingsGrid, type HoldingRow } from './HoldingsGrid'
import { AddEditCardModal } from './AddEditCardModal'
import { GradingSubmissionModal } from './GradingSubmissionModal'
import { GradingLogModal } from './GradingLogModal'

interface Summary {
  totalValue: number
  totalGain: number
  totalGainPct: number | null
  cardCount: number
  uniqueCount: number
  realizedGain: number
}

export interface Txn {
  id: string
  cardId: string
  cardName: string
  kind: string
  happenedAt: string
  quantity: number | null
  amount: number | null
  realized: number | null
}

export function CollectionClient({
  summary,
  rows,
  txns,
  initialSeries,
  initialRange,
}: {
  summary: Summary
  rows: HoldingRow[]
  txns: Txn[]
  initialSeries: ValuePoint[]
  initialRange: Range
}) {
  const router = useRouter()
  const [range, setRange] = useState<Range>(initialRange)
  const [series, setSeries] = useState<ValuePoint[]>(initialSeries)
  const [seriesLoading, setSeriesLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  // When set, the add modal opens pinned to this card (add-another flow) with the
  // grade still selectable, so a second copy can be a different grade/slab.
  const [addPreset, setAddPreset] = useState<{ id: string; name: string; image: string } | null>(null)
  const [gradingOpen, setGradingOpen] = useState(false)
  const [gradingPreset, setGradingPreset] = useState<HoldingRow | null>(null)
  const [gradingLogOpen, setGradingLogOpen] = useState(false)
  const rawHoldings = rows.filter(r => !r.gradingCompany)
  const hasGraded = rows.some(r => r.gradingCompany)

  function openGrading(preset: HoldingRow | null) { setGradingPreset(preset); setGradingOpen(true) }

  async function loadSeries(r: Range) {
    setRange(r)
    setSeriesLoading(true)
    try {
      const res = await fetch(`/api/collection/value-series?range=${r}`)
      if (res.ok) setSeries((await res.json()).series ?? [])
    } finally {
      setSeriesLoading(false)
    }
  }

  // After a mutation: refresh server data (rows + summary) and recompute the
  // chart for the current range.
  function refreshAll() {
    router.refresh()
    loadSeries(range)
  }

  function openAdd() { setAddPreset(null); setModalOpen(true) }
  // "Add another" from a holding: same card, grade chosen fresh → a new line if
  // the grade differs, or bumps the matching line if it's the same.
  function openAddAnother(row: HoldingRow) {
    setAddPreset({ id: row.cardId, name: row.cardName, image: row.imageUrl })
    setModalOpen(true)
  }
  function closeAdd() { setModalOpen(false); setAddPreset(null) }

  // Dark canvas for the collection: also flip the (global) site header to
  // transparent for this route so it doesn't clash. The class is removed when
  // leaving so other pages keep the orange bar. See the [html.collection-dark]
  // variants on the header in (site)/layout.tsx.
  useEffect(() => {
    document.documentElement.classList.add('collection-dark')
    return () => document.documentElement.classList.remove('collection-dark')
  }, [])

  return (
    // Full-bleed dark canvas so the light slabs/cards read as raised surfaces.
    // Negative margins cancel the site <main> padding, then we re-add it inside.
    <div className="-mx-4 -my-8 px-4 py-8 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 bg-zinc-900 min-h-[calc(100vh-3.5rem)]">
      <div className="flex items-start justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold text-zinc-100">Collection</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/collection/activity"
            className="px-4 py-2 rounded-lg text-sm font-semibold text-zinc-200 ring-1 ring-zinc-600 hover:bg-zinc-800 transition-colors"
          >
            Transactions
          </Link>
          {hasGraded && (
            <button
              type="button"
              onClick={() => setGradingLogOpen(true)}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-zinc-200 ring-1 ring-zinc-600 hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              Grading log
            </button>
          )}
          {rawHoldings.length > 0 && (
            <button
              type="button"
              onClick={() => openGrading(null)}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-zinc-200 ring-1 ring-zinc-600 hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              Log grading
            </button>
          )}
          <button
            type="button"
            onClick={openAdd}
            className="px-4 py-2 rounded-lg text-sm font-bold bg-orange-500 hover:bg-orange-600 text-white transition-colors cursor-pointer"
          >
            + Add card
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-zinc-700/60 bg-zinc-800/60 py-16 text-center">
          <p className="text-zinc-100 font-semibold mb-1">Your collection is empty</p>
          <p className="text-sm text-zinc-400 mb-5">
            Cards you buy on Nomi land here automatically. You can also add cards you already own.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button type="button" onClick={openAdd} className="px-4 py-2 rounded-lg text-sm font-bold bg-orange-500 hover:bg-orange-600 text-white cursor-pointer">+ Add card</button>
            <Link href="/search" className="px-4 py-2 rounded-lg text-sm font-semibold text-zinc-200 ring-1 ring-zinc-600 hover:bg-zinc-700">Browse cards</Link>
          </div>
        </div>
      ) : (
        <>
          {/* Two columns on desktop: value chart (wider) beside recent
              transactions. Collapses to a single stacked column on mobile. */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            <div className="lg:col-span-2 rounded-xl border border-zinc-700/60 bg-zinc-800/60 p-5">
              <PortfolioHero {...summary} />
              <div className="mt-4">
                <PortfolioChart series={series} range={range} onRangeChange={loadSeries} loading={seriesLoading} />
              </div>
            </div>
            <div className="lg:col-span-1 rounded-xl border border-zinc-700/60 bg-zinc-800/60 p-5">
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-sm font-bold text-zinc-100">Recent transactions</h2>
                <Link href="/collection/activity" className="text-xs font-semibold text-orange-400 hover:text-orange-300">
                  View all →
                </Link>
              </div>
              <RecentTransactions txns={txns} />
            </div>
          </div>

          {/* Holdings */}
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-lg font-bold text-zinc-100">Holdings</h2>
            <span className="text-xs text-zinc-400 tabular-nums">{rows.length} {rows.length === 1 ? 'line' : 'lines'}</span>
          </div>
          <HoldingsGrid rows={rows} onLogGrading={openGrading} onAddAnother={openAddAnother} />
        </>
      )}

      <AddEditCardModal open={modalOpen} onClose={closeAdd} onSaved={refreshAll} editItem={null} presetCard={addPreset} />
      <GradingSubmissionModal open={gradingOpen} onClose={() => setGradingOpen(false)} onSaved={refreshAll} rawHoldings={rawHoldings} preset={gradingPreset} />
      <GradingLogModal open={gradingLogOpen} onClose={() => setGradingLogOpen(false)} rows={rows} onChanged={refreshAll} />
    </div>
  )
}

const KIND_LABEL: Record<string, string> = { buy: 'Bought', sell: 'Sold', grade: 'Graded', basis: 'Adjusted', note: 'Note' }
const KIND_DOT: Record<string, string> = { buy: 'bg-zinc-400', sell: 'bg-emerald-500', grade: 'bg-purple-500', basis: 'bg-amber-500', note: 'bg-zinc-300' }

function fmtUSD(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtDate(s: string) {
  // UTC-pinned (see the activity ledger): keep date-only values on their
  // stored calendar day regardless of the viewer's timezone.
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function RecentTransactions({ txns }: { txns: Txn[] }) {
  if (txns.length === 0) {
    return <p className="text-sm text-zinc-400 py-6 text-center">No transactions yet.</p>
  }
  return (
    <ul className="divide-y divide-zinc-700/50">
      {txns.map(t => {
        const realized = t.realized
        return (
          <li key={t.id} className="py-2.5 first:pt-0 flex items-center gap-3">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${KIND_DOT[t.kind] ?? 'bg-zinc-500'}`} />
            <div className="min-w-0 flex-1">
              <Link href={`/card/${t.cardId}`} className="text-sm font-medium text-zinc-100 hover:text-orange-400 truncate block">
                {t.cardName}
              </Link>
              <p className="text-[11px] text-zinc-500">
                {KIND_LABEL[t.kind] ?? t.kind}{t.quantity ? ` ×${t.quantity}` : ''} · {fmtDate(t.happenedAt)}
              </p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-sm tabular-nums text-zinc-200">{t.amount != null ? fmtUSD(t.amount) : '—'}</p>
              {realized != null && (
                <p className={`text-[11px] font-semibold tabular-nums ${realized >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {realized >= 0 ? '+' : '−'}{fmtUSD(Math.abs(realized))}
                </p>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
