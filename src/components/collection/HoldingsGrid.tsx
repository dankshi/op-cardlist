'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { gradeLabel } from '@/lib/gradingStyle'
import { Slab } from './Slab'

export interface HoldingRow {
  id: string
  cardId: string
  cardName: string
  imageUrl: string
  setId: string | null
  rarity: string | null
  quantity: number
  acquiredPrice: number | null
  acquiredDate: string | null
  gradingCompany: string | null
  grade: string | null
  customValue: number | null
  isCustomValue: boolean
  serialNumber: string | null
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
}: {
  rows: HoldingRow[]
}) {
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
            className="w-full pl-10 pr-3 py-2 rounded-lg border border-zinc-200 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400"
          />
        </div>
        <select
          value={sort}
          onChange={e => setSort(e.target.value as Sort)}
          className="px-3 py-2 rounded-lg border border-zinc-200 bg-white text-sm font-medium text-zinc-900 hover:border-zinc-400 focus:outline-none cursor-pointer"
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
                    typeFilter === c.v ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-600 ring-1 ring-zinc-200 hover:ring-zinc-400'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1.5 text-sm text-zinc-500">
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-zinc-400">$</span>
              <input type="number" min="0" value={minPrice} onChange={e => setMinPrice(e.target.value)} placeholder="Min" className="w-20 pl-5 pr-2 py-1 rounded-md border border-zinc-200 text-xs tabular-nums text-zinc-900 focus:outline-none focus:border-zinc-400" />
            </div>
            <span className="text-zinc-300">–</span>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-zinc-400">$</span>
              <input type="number" min="0" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} placeholder="Max" className="w-20 pl-5 pr-2 py-1 rounded-md border border-zinc-200 text-xs tabular-nums text-zinc-900 focus:outline-none focus:border-zinc-400" />
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-x-4 gap-y-6">
        {visible.map(row => {
          const isGraded = !!(row.gradingCompany && row.grade)
          const gradeText = gradeLabel(row.gradingCompany, row.grade)
          // Per-card return vs avg cost — sized to match the hero price (the
          // per-unit "quote"), like a brokerage position cell.
          const perCardChange = row.marketPrice != null && row.acquiredPrice != null
            ? row.marketPrice - row.acquiredPrice
            : null
          const hasReturn = perCardChange != null && Math.abs(perCardChange) >= 0.005
          const up = perCardChange != null ? perCardChange >= 0 : (row.gain ?? 0) >= 0
          const retColor = perCardChange == null ? 'text-zinc-400' : up ? 'text-emerald-600' : 'text-red-600'
          const context = [row.rarity, row.cardId, gradeText].filter(Boolean).join(' · ')
          return (
            <Link
              key={row.id}
              href={`/card/${row.cardId.toLowerCase()}`}
              className="group block text-left"
            >
              {isGraded ? (
                <Slab imageUrl={row.imageUrl} cardName={row.cardName} company={row.gradingCompany!} grade={row.grade!} cardId={row.cardId} serialNumber={row.serialNumber} />
              ) : (
                <div className="relative rounded-lg overflow-hidden bg-zinc-100 aspect-[5/7] ring-1 ring-transparent group-hover:ring-zinc-300 transition-all">
                  {row.imageUrl && (
                    <Image src={row.imageUrl} alt={row.cardName} fill sizes="(max-width:768px) 50vw, 20vw" className="object-cover" unoptimized />
                  )}
                </div>
              )}

              <div className="mt-2.5">
                {/* Identity */}
                <p className="text-sm font-bold text-zinc-900 leading-tight line-clamp-2 group-hover:text-orange-600 transition-colors">
                  {row.cardName}
                </p>
                <p className="text-[11px] text-zinc-400 truncate mt-0.5">{context}</p>

                {/* Hero — individual (per-card) market price, the quote. */}
                <div className="mt-1.5 flex items-baseline gap-1.5">
                  <span className="text-xl font-bold tabular-nums tracking-tight text-zinc-900 leading-none">
                    {row.marketPrice != null ? fmtUSD(row.marketPrice) : '—'}
                  </span>
                  {perCardChange != null && (
                    <span className={`text-xs leading-none ${retColor}`}>{up ? '▲' : '▼'}</span>
                  )}
                </div>
                {/* Return vs avg cost ($ + %), reserved height so tiles align. */}
                <div className="min-h-[16px] mt-1 text-[11px] font-semibold tabular-nums">
                  {hasReturn ? (
                    <span className={retColor}>
                      {up ? '+' : '−'}{fmtUSD(Math.abs(perCardChange!))}
                      {row.gainPct != null ? ` (${up ? '+' : '−'}${(Math.abs(row.gainPct) * 100).toFixed(2)}%)` : ''}
                    </span>
                  ) : (
                    <span className="text-zinc-300">—</span>
                  )}
                </div>

                {/* Position summary — quantity · total value, then avg cost. */}
                <div className="mt-1.5 pt-1.5 border-t border-zinc-100 flex items-center justify-between text-[11px] tabular-nums">
                  <span className="text-zinc-500">
                    Qty {row.quantity}
                    {row.serialNumber && <span className="text-zinc-400"> · #{row.serialNumber}</span>}
                  </span>
                  <span className="font-semibold text-zinc-900">{row.currentValue != null ? fmtUSD(row.currentValue) : '—'}</span>
                </div>
                <div className="flex items-center justify-between text-[10px] tabular-nums text-zinc-400 mt-0.5">
                  <span>Avg cost</span>
                  <span>{row.acquiredPrice != null ? fmtUSD(row.acquiredPrice) : '—'}</span>
                </div>
              </div>
            </Link>
          )
        })}
      </div>

      {visible.length === 0 && (
        <p className="text-center py-12 text-sm text-zinc-400">No holdings match &ldquo;{query}&rdquo;.</p>
      )}
    </div>
  )
}
