'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Slab } from './Slab'
import { ManageHoldingModal } from './ManageHoldingModal'

export interface HoldingRow {
  id: string
  cardId: string
  cardName: string
  imageUrl: string
  setId: string | null
  setName: string | null
  rarity: string | null
  quantity: number
  acquiredPrice: number | null
  acquiredDate: string | null
  gradingCompany: string | null
  grade: string | null
  customValue: number | null
  isCustomValue: boolean
  /** Our market-derived value (slab comp / listing / raw), ignoring any override
   *  — shown next to a custom price so the owner still sees the calculated one. */
  calculatedPrice: number | null
  serialNumber: string | null
  certNumber: string | null
  marketPrice: number | null
  currentValue: number | null
  costBasis: number | null
  gain: number | null
  gainPct: number | null
}

type Sort = 'value' | 'gain' | 'name' | 'qty'
const SORTS: { v: Sort; label: string }[] = [
  { v: 'value', label: 'Value: high to low' },
  { v: 'gain', label: 'Gain: high to low' },
  { v: 'name', label: 'Name: A–Z' },
  { v: 'qty', label: 'Quantity' },
]

function fmtUSD(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function HoldingsGrid({
  rows,
  onLogGrading,
}: {
  rows: HoldingRow[]
  /** Open the grading-submission builder pre-filled with this raw holding. */
  onLogGrading?: (preset: HoldingRow) => void
}) {
  const router = useRouter()
  // Track the managed holding by id (not the row object) so it stays fresh
  // after a router.refresh() re-pulls the rows. Disappears (modal closes) if
  // the line is removed.
  const [managingId, setManagingId] = useState<string | null>(null)
  const managing = managingId ? rows.find(r => r.id === managingId) ?? null : null
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('value')
  // Free filters (no PRO gate): grade source + price range.
  const [typeFilter, setTypeFilter] = useState<string>('all') // 'all' | 'raw' | <company>
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')

  // Build the grade-source chips from what's actually in the collection.
  const companies = useMemo(
    () => [...new Set(rows.filter(r => r.gradingCompany).map(r => r.gradingCompany!))].sort(),
    [rows],
  )
  const hasRaw = useMemo(() => rows.some(r => !r.gradingCompany), [rows])
  const chips: { v: string; label: string }[] = [
    { v: 'all', label: 'All' },
    ...(hasRaw ? [{ v: 'raw', label: 'Raw' }] : []),
    ...companies.map(c => ({ v: c, label: c })),
  ]

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const tokens = q ? q.split(/\s+/) : []
    const min = minPrice ? Number(minPrice) : null
    const max = maxPrice ? Number(maxPrice) : null
    const filtered = rows.filter(r => {
      if (tokens.length > 0) {
        const hay = `${r.cardName} ${r.cardId} ${r.gradingCompany ?? ''} ${r.grade ?? ''}`.toLowerCase()
        if (!tokens.every(t => hay.includes(t))) return false
      }
      if (typeFilter === 'raw' && r.gradingCompany) return false
      if (typeFilter !== 'all' && typeFilter !== 'raw' && r.gradingCompany !== typeFilter) return false
      const v = r.currentValue ?? 0
      if (min != null && v < min) return false
      if (max != null && v > max) return false
      return true
    })
    return [...filtered].sort((a, b) => {
      switch (sort) {
        case 'gain': return (b.gain ?? -Infinity) - (a.gain ?? -Infinity)
        case 'name': return a.cardName.localeCompare(b.cardName)
        case 'qty': return b.quantity - a.quantity
        case 'value':
        default: return (b.currentValue ?? 0) - (a.currentValue ?? 0)
      }
    })
  }, [rows, query, sort, typeFilter, minPrice, maxPrice])

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search your holdings…"
            className="w-full pl-10 pr-3 py-2 rounded-lg border border-zinc-700 bg-zinc-800 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-500"
          />
        </div>
        <select
          value={sort}
          onChange={e => setSort(e.target.value as Sort)}
          className="px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-800 text-sm font-medium text-zinc-100 hover:border-zinc-500 focus:outline-none cursor-pointer"
        >
          {SORTS.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
        </select>
      </div>

      {/* Filters — grade source + price range. All free. */}
      {(chips.length > 2 || rows.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-5">
          {chips.length > 2 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {chips.map(c => (
                <button
                  key={c.v}
                  type="button"
                  onClick={() => setTypeFilter(c.v)}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                    typeFilter === c.v ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-800 text-zinc-300 ring-1 ring-zinc-700 hover:ring-zinc-500'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1.5 text-sm text-zinc-400">
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-zinc-500">$</span>
              <input type="number" min="0" value={minPrice} onChange={e => setMinPrice(e.target.value)} placeholder="Min" className="w-20 pl-5 pr-2 py-1 rounded-md border border-zinc-700 bg-zinc-800 text-xs tabular-nums text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-500" />
            </div>
            <span className="text-zinc-600">–</span>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-zinc-500">$</span>
              <input type="number" min="0" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} placeholder="Max" className="w-20 pl-5 pr-2 py-1 rounded-md border border-zinc-700 bg-zinc-800 text-xs tabular-nums text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-500" />
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-x-7 gap-y-12">
        {visible.map(row => {
          const isGraded = !!(row.gradingCompany && row.grade)
          // Per-card return vs avg cost — sized to match the hero price (the
          // per-unit "quote"), like a brokerage position cell.
          const perCardChange = row.marketPrice != null && row.acquiredPrice != null
            ? row.marketPrice - row.acquiredPrice
            : null
          const hasReturn = perCardChange != null && Math.abs(perCardChange) >= 0.005
          const up = perCardChange != null ? perCardChange >= 0 : (row.gain ?? 0) >= 0
          const retColor = perCardChange == null ? 'text-zinc-500' : up ? 'text-emerald-400' : 'text-red-400'
          return (
            <div key={row.id} className="group">
              {/* Fixed-height image stage (a slab's aspect, the tallest tile
                  type) so raw cards and any slab line up — text always starts at
                  the same baseline. Bottom-aligned so the card sits flush above
                  its text (no gap); shorter tiles get their slack on top. */}
              <button
                type="button"
                onClick={() => setManagingId(row.id)}
                className="flex items-end justify-center w-full aspect-[2004/3116] cursor-pointer"
              >
                {isGraded ? (
                  <Slab imageUrl={row.imageUrl} cardName={row.cardName} company={row.gradingCompany!} grade={row.grade!} certNumber={row.certNumber} />
                ) : (
                  <div className="relative w-full rounded-lg overflow-hidden bg-zinc-800 aspect-[5/7] ring-1 ring-white/5 group-hover:ring-white/20 transition-all">
                    {row.imageUrl && (
                      <Image src={row.imageUrl} alt={row.cardName} fill sizes="(max-width:768px) 50vw, 20vw" className="object-cover" unoptimized />
                    )}
                  </div>
                )}
              </button>

              <div className="mt-2.5 space-y-3 text-left">
                {/* Collectr-style: the set name, linked to the set (not the card name). */}
                {row.setId ? (
                  <Link
                    href={`/${row.setId.toLowerCase()}`}
                    className="block text-sm font-semibold text-zinc-200 underline decoration-zinc-600 underline-offset-2 hover:text-orange-400 hover:decoration-orange-400 line-clamp-1 transition-colors"
                  >
                    {row.setName ?? row.setId.toUpperCase()}
                  </Link>
                ) : (
                  <p className="text-sm font-semibold text-zinc-300 line-clamp-1">{row.cardName}</p>
                )}

                {/* Hero — per-card price (left) with the return on the same line
                    (right) so a return never adds a row and shifts the layout. */}
                <button type="button" onClick={() => setManagingId(row.id)} className="block w-full text-left cursor-pointer">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex items-center gap-1 min-w-0">
                      <span className={`text-xl font-bold tabular-nums tracking-tight leading-none ${row.isCustomValue ? 'text-amber-400' : 'text-zinc-100'}`}>
                        {row.marketPrice != null ? fmtUSD(row.marketPrice) : '—'}
                      </span>
                      {row.isCustomValue && (
                        <svg className="w-3 h-3 flex-shrink-0 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                          <title>Your set value (override)</title>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
                        </svg>
                      )}
                    </span>
                    {hasReturn && (
                      <span className={`text-[11px] font-semibold tabular-nums leading-none whitespace-nowrap ${retColor}`}>
                        {up ? '▲' : '▼'} {up ? '+' : '−'}{row.gainPct != null ? `${(Math.abs(row.gainPct) * 100).toFixed(1)}%` : fmtUSD(Math.abs(perCardChange!))}
                      </span>
                    )}
                  </div>

                  {/* Below the headline: our calculated estimate next to a custom
                      price, or surface that we have no slab estimate yet. */}
                  {row.isCustomValue && row.calculatedPrice != null && (
                    <div className="mt-0.5 text-[11px] text-zinc-500 tabular-nums">Est. {fmtUSD(row.calculatedPrice)}</div>
                  )}
                  {row.isCustomValue && row.calculatedPrice == null && row.gradingCompany && row.grade && (
                    <div className="mt-0.5 text-[11px] text-zinc-500">No slab estimate yet</div>
                  )}
                  {!row.isCustomValue && row.marketPrice == null && row.gradingCompany && row.grade && (
                    <div className="mt-0.5 text-[11px] text-amber-500/80">No slab estimate — set a value</div>
                  )}

                  {/* Position summary — quantity · total value, then avg cost. */}
                  <div className="mt-3 pt-3 border-t border-zinc-700/60 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] tabular-nums">
                      <span className="text-zinc-400">
                        Qty {row.quantity}
                        {row.serialNumber && <span className="text-zinc-500"> · #{row.serialNumber}</span>}
                      </span>
                      <span className="font-semibold text-zinc-100">{row.currentValue != null ? fmtUSD(row.currentValue) : '—'}</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] tabular-nums text-zinc-500">
                      <span>Avg cost</span>
                      <span>{row.acquiredPrice != null ? fmtUSD(row.acquiredPrice) : '—'}</span>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {visible.length === 0 && (
        <p className="text-center py-12 text-sm text-zinc-400">No holdings match &ldquo;{query}&rdquo;.</p>
      )}

      {managing && (
        <ManageHoldingModal
          row={managing}
          onClose={() => setManagingId(null)}
          onChanged={() => router.refresh()}
          onLogGrading={onLogGrading ? () => { const r = managing; setManagingId(null); onLogGrading(r) } : undefined}
        />
      )}
    </div>
  )
}
