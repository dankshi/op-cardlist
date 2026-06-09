'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Range, ValuePoint } from '@/lib/collection-history'
import { PortfolioHero } from './PortfolioHero'
import { PortfolioChart } from './PortfolioChart'
import { HoldingsGrid, type HoldingRow } from './HoldingsGrid'
import { AddEditCardModal } from './AddEditCardModal'

interface Summary {
  totalValue: number
  totalGain: number
  totalGainPct: number | null
  cardCount: number
  uniqueCount: number
  realizedGain: number
}

export function CollectionClient({
  summary,
  rows,
  initialSeries,
  initialRange,
}: {
  summary: Summary
  rows: HoldingRow[]
  initialSeries: ValuePoint[]
  initialRange: Range
}) {
  const router = useRouter()
  const [range, setRange] = useState<Range>(initialRange)
  const [series, setSeries] = useState<ValuePoint[]>(initialSeries)
  const [seriesLoading, setSeriesLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)

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

  function openAdd() { setModalOpen(true) }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold text-zinc-900">Collection</h1>
        <button
          type="button"
          onClick={openAdd}
          className="px-4 py-2 rounded-lg text-sm font-bold bg-orange-500 hover:bg-orange-600 text-white transition-colors cursor-pointer"
        >
          + Add card
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white py-16 text-center">
          <p className="text-zinc-900 font-semibold mb-1">Your collection is empty</p>
          <p className="text-sm text-zinc-500 mb-5">
            Cards you buy on Nomi land here automatically. You can also add cards you already own.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button type="button" onClick={openAdd} className="px-4 py-2 rounded-lg text-sm font-bold bg-orange-500 hover:bg-orange-600 text-white cursor-pointer">+ Add card</button>
            <Link href="/search" className="px-4 py-2 rounded-lg text-sm font-semibold text-zinc-700 ring-1 ring-zinc-300 hover:bg-zinc-50">Browse cards</Link>
          </div>
        </div>
      ) : (
        <>
          {/* Portfolio hero + value chart */}
          <div className="rounded-xl border border-zinc-200 bg-white p-5 mb-8">
            <PortfolioHero {...summary} />
            <div className="mt-4">
              <PortfolioChart series={series} range={range} onRangeChange={loadSeries} loading={seriesLoading} />
            </div>
          </div>

          {/* Holdings */}
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-lg font-bold text-zinc-900">Holdings</h2>
            <span className="text-xs text-zinc-400 tabular-nums">{rows.length} {rows.length === 1 ? 'line' : 'lines'}</span>
          </div>
          <HoldingsGrid rows={rows} />
        </>
      )}

      <AddEditCardModal open={modalOpen} onClose={() => setModalOpen(false)} onSaved={refreshAll} editItem={null} />
    </div>
  )
}
