'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { gradeLabel } from '@/lib/gradingStyle'

export interface HoldingRow {
  id: string
  cardId: string
  cardName: string
  imageUrl: string
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
          const up = (row.gain ?? 0) >= 0
          const gainColor = row.gain == null ? 'text-zinc-400' : up ? 'text-emerald-600' : 'text-red-600'
          // Grade as plain text — "Near Mint" for raw, "Black Label"/"Pristine"
          // for the named top tiers, "PSA 10" etc. otherwise. No pills/borders.
          const gradeText = gradeLabel(row.gradingCompany, row.grade)
          return (
            <Link
              key={row.id}
              href={`/card/${row.cardId.toLowerCase()}`}
              className="group block text-left"
            >
              {/* Clean card art — no overlays. Whole tile opens the editor. */}
              <div className="relative rounded-lg overflow-hidden bg-zinc-100 aspect-[5/7] ring-1 ring-transparent group-hover:ring-zinc-300 transition-all">
                {row.imageUrl && (
                  <Image src={row.imageUrl} alt={row.cardName} fill sizes="(max-width:768px) 50vw, 20vw" className="object-cover" unoptimized />
                )}
              </div>

              <div className="mt-2">
                {/* Price + grade on one clean row. */}
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-lg font-bold tabular-nums tracking-tight text-zinc-900">
                    {row.currentValue != null ? fmtUSD(row.currentValue) : '—'}
                  </span>
                  <span className="text-xs text-zinc-400 truncate">{gradeText}</span>
                </div>
                {/* Always rendered (with reserved height) so a card with a
                    serial / qty / gain isn't taller than one without — adding
                    a serial never shifts the grid. */}
                <div className="mt-0.5 min-h-[16px] flex items-center gap-2 text-[11px] tabular-nums text-zinc-400">
                  {row.gain != null && (
                    <span className={`font-semibold ${gainColor}`}>
                      {up ? '+' : '−'}{row.gainPct != null ? `${(Math.abs(row.gainPct) * 100).toFixed(1)}%` : fmtUSD(Math.abs(row.gain))}
                    </span>
                  )}
                  {row.quantity > 1 && <span>×{row.quantity}</span>}
                  {row.serialNumber && <span>#{row.serialNumber}</span>}
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
