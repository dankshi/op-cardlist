'use client'

import { Fragment, useEffect, useState, useMemo } from 'react'

interface MangaCard {
  id: string
  alt_listing_id: string
  set_code: string
  card_name: string
  full_name: string | null
  subject: string | null
  brand: string | null
  variety: string | null
  card_number: string | null
  image_url: string | null
  alt_url: string
  lowest_price: number | null
  psa_10: number
  psa_9: number
  psa_total: number
  bgs_bl: number
  bgs_10: number
  bgs_95: number
  bgs_total: number
  last_scraped_at: string
}

interface Listing {
  id: string
  tracker_id: string
  listing_id: string
  listing_type: string
  grading_company: string
  grade: string
  price: number
  auction_house: string
  image_url: string | null
  external_url: string | null
  listed_at: string
}

type SortKey = 'set' | 'name' | 'price' | 'psa10' | 'psaTotal' | 'bgs95' | 'bgsTotal'
type SortDir = 'asc' | 'desc'

export default function MangaTrackerPage() {
  const [cards, setCards] = useState<MangaCard[]>([])
  const [listings, setListings] = useState<Record<string, Listing[]>>({})
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('set')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [setFilter, setSetFilter] = useState<string>('all')
  const [expandedCard, setExpandedCard] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/manga-tracker')
      .then(r => r.json())
      .then(data => {
        setCards(data.cards || [])
        setListings(data.listings || {})
        setLastUpdated(data.lastUpdated)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const sets = useMemo(() => {
    const s = new Set(cards.map(c => c.set_code))
    return ['all', ...Array.from(s).sort()]
  }, [cards])

  const sorted = useMemo(() => {
    let filtered = setFilter === 'all' ? cards : cards.filter(c => c.set_code === setFilter)
    return [...filtered].sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'set': cmp = a.set_code.localeCompare(b.set_code) || a.card_name.localeCompare(b.card_name); break
        case 'name': cmp = a.card_name.localeCompare(b.card_name); break
        case 'price': cmp = (a.lowest_price ?? 0) - (b.lowest_price ?? 0); break
        case 'psa10': cmp = a.psa_10 - b.psa_10; break
        case 'psaTotal': cmp = a.psa_total - b.psa_total; break
        case 'bgs95': cmp = (a.bgs_bl + a.bgs_10 + a.bgs_95) - (b.bgs_bl + b.bgs_10 + b.bgs_95); break
        case 'bgsTotal': cmp = a.bgs_total - b.bgs_total; break
      }
      return sortDir === 'desc' ? -cmp : cmp
    })
  }, [cards, sortKey, sortDir, setFilter])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === 'set' || key === 'name' ? 'asc' : 'desc') }
  }

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <span className="text-zinc-300 ml-1">↕</span>
    return <span className="text-zinc-900 ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  const fmt = (n: number | null) => n == null ? '—' : `$${n.toLocaleString()}`

  const totals = useMemo(() => {
    const filtered = setFilter === 'all' ? cards : cards.filter(c => c.set_code === setFilter)
    return {
      count: filtered.length,
      totalValue: filtered.reduce((s, c) => s + (c.lowest_price ?? 0), 0),
      totalPsa10: filtered.reduce((s, c) => s + c.psa_10, 0),
      totalPsaPop: filtered.reduce((s, c) => s + c.psa_total, 0),
      totalBgsPop: filtered.reduce((s, c) => s + c.bgs_total, 0),
    }
  }, [cards, setFilter])

  const formatDate = (d: string) => {
    const date = new Date(d)
    return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear().toString().slice(-2)}`
  }

  const gradeLabel = (company: string, grade: string) => {
    if (company === 'BGS' && grade === 'BL') return 'BGS BL'
    return `${company} ${grade}`
  }

  const gradeBadgeClass = (company: string, grade: string) => {
    if (company === 'BGS' && grade === 'BL') return 'bg-yellow-100 text-yellow-800'
    if (company === 'PSA' && grade === '10') return 'bg-blue-100 text-blue-800'
    if (company === 'BGS' && (grade === '10' || grade === '9.5')) return 'bg-purple-100 text-purple-800'
    return 'bg-zinc-100 text-zinc-600'
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-zinc-900" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Manga Tracker</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Population &amp; pricing from alt.xyz
          {lastUpdated && <> &middot; Updated {new Date(lastUpdated).toLocaleDateString()}</>}
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-white rounded-xl border border-zinc-200 p-4">
          <div className="text-xs text-zinc-500 uppercase tracking-wide">Cards</div>
          <div className="text-2xl font-bold mt-1">{totals.count}</div>
        </div>
        <div className="bg-white rounded-xl border border-zinc-200 p-4">
          <div className="text-xs text-zinc-500 uppercase tracking-wide">Total Value</div>
          <div className="text-2xl font-bold mt-1">${totals.totalValue.toLocaleString()}</div>
        </div>
        <div className="bg-white rounded-xl border border-zinc-200 p-4">
          <div className="text-xs text-zinc-500 uppercase tracking-wide">PSA 10 Pop</div>
          <div className="text-2xl font-bold mt-1">{totals.totalPsa10.toLocaleString()}</div>
        </div>
        <div className="bg-white rounded-xl border border-zinc-200 p-4">
          <div className="text-xs text-zinc-500 uppercase tracking-wide">PSA Total</div>
          <div className="text-2xl font-bold mt-1">{totals.totalPsaPop.toLocaleString()}</div>
        </div>
        <div className="bg-white rounded-xl border border-zinc-200 p-4">
          <div className="text-xs text-zinc-500 uppercase tracking-wide">BGS Total</div>
          <div className="text-2xl font-bold mt-1">{totals.totalBgsPop.toLocaleString()}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {sets.map(s => (
          <button
            key={s}
            onClick={() => setSetFilter(s)}
            className={`px-3 py-1 text-xs rounded-full transition font-medium ${
              setFilter === s
                ? 'bg-zinc-900 text-white'
                : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
            }`}
          >
            {s === 'all' ? 'All Sets' : s}
          </button>
        ))}
      </div>

      {/* Main table */}
      <div className="bg-white rounded-xl border border-zinc-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-100 bg-zinc-50">
              <th className="text-left px-3 py-3 font-medium text-zinc-500 w-10"></th>
              <th className="text-left px-3 py-3 font-medium text-zinc-500 cursor-pointer select-none" onClick={() => toggleSort('set')}>
                Set <SortIcon k="set" />
              </th>
              <th className="text-left px-3 py-3 font-medium text-zinc-500 cursor-pointer select-none" onClick={() => toggleSort('name')}>
                Card <SortIcon k="name" />
              </th>
              <th className="text-right px-3 py-3 font-medium text-zinc-500 cursor-pointer select-none" onClick={() => toggleSort('price')}>
                Price <SortIcon k="price" />
              </th>
              <th className="text-right px-3 py-3 font-medium text-blue-500 cursor-pointer select-none" onClick={() => toggleSort('psa10')}>
                PSA 10 <SortIcon k="psa10" />
              </th>
              <th className="text-right px-3 py-3 font-medium text-blue-400">PSA 9</th>
              <th className="text-right px-3 py-3 font-medium text-blue-500 cursor-pointer select-none" onClick={() => toggleSort('psaTotal')}>
                PSA Tot <SortIcon k="psaTotal" />
              </th>
              <th className="text-right px-3 py-3 font-medium text-purple-500">BGS BL</th>
              <th className="text-right px-3 py-3 font-medium text-purple-400">BGS 10</th>
              <th className="text-right px-3 py-3 font-medium text-purple-400 cursor-pointer select-none" onClick={() => toggleSort('bgs95')}>
                BGS 9.5 <SortIcon k="bgs95" />
              </th>
              <th className="text-right px-3 py-3 font-medium text-purple-500 cursor-pointer select-none" onClick={() => toggleSort('bgsTotal')}>
                BGS Tot <SortIcon k="bgsTotal" />
              </th>
              <th className="text-right px-3 py-3 font-medium text-zinc-400 w-10">
                <span title="Active listings">#</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(card => {
              const cardListings = listings[card.id] || []
              const isExpanded = expandedCard === card.id
              return (
                <Fragment key={card.alt_listing_id}>
                  <tr
                    className={`border-b border-zinc-50 hover:bg-zinc-50 transition cursor-pointer ${isExpanded ? 'bg-zinc-50' : ''}`}
                    onClick={() => setExpandedCard(isExpanded ? null : card.id)}
                  >
                    <td className="px-3 py-2">
                      {card.image_url ? (
                        <img
                          src={card.image_url}
                          alt={card.card_name}
                          className="w-8 h-11 object-cover rounded"
                        />
                      ) : (
                        <div className="w-8 h-11 bg-zinc-100 rounded flex items-center justify-center text-zinc-400 text-xs">?</div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-block bg-zinc-100 text-zinc-700 text-xs font-mono px-2 py-0.5 rounded">
                        {card.set_code}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <a
                        href={card.alt_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-zinc-900 hover:text-blue-600 transition font-medium"
                        onClick={e => e.stopPropagation()}
                      >
                        {card.card_name}
                      </a>
                      {card.card_number && (
                        <span className="text-zinc-400 text-xs ml-2">#{card.card_number}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      <span className={card.lowest_price ? 'text-zinc-900 font-semibold' : 'text-zinc-400'}>
                        {fmt(card.lowest_price)}
                      </span>
                    </td>
                    {/* PSA */}
                    <td className="px-3 py-2 text-right font-mono font-semibold text-blue-700">
                      {card.psa_10.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-blue-500">
                      {card.psa_9.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-blue-400">
                      {card.psa_total.toLocaleString()}
                    </td>
                    {/* BGS */}
                    <td className="px-3 py-2 text-right font-mono font-semibold text-purple-700">
                      {card.bgs_bl.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-purple-600">
                      {card.bgs_10.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-purple-500">
                      {card.bgs_95.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-purple-400">
                      {card.bgs_total.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {cardListings.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
                          {cardListings.length}
                          <span className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▾</span>
                        </span>
                      )}
                    </td>
                  </tr>
                  {/* Expanded listings */}
                  {isExpanded && cardListings.length > 0 && (
                    <tr>
                      <td colSpan={12} className="px-0 py-0">
                        <div className="bg-zinc-50 border-y border-zinc-100 px-4 py-3">
                          <div className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">
                            Active Listings ({cardListings.length})
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                            {cardListings.map(l => (
                              <a
                                key={l.listing_id}
                                href={l.external_url || '#'}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-3 bg-white rounded-lg border border-zinc-200 p-2.5 hover:border-zinc-300 hover:shadow-sm transition"
                              >
                                {l.image_url ? (
                                  <img src={l.image_url} alt="" className="w-10 h-14 object-cover rounded" />
                                ) : (
                                  <div className="w-10 h-14 bg-zinc-100 rounded" />
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-sm">${l.price?.toLocaleString()}</span>
                                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${gradeBadgeClass(l.grading_company, l.grade)}`}>
                                      {gradeLabel(l.grading_company, l.grade)}
                                    </span>
                                  </div>
                                  <div className="text-xs text-zinc-400 mt-0.5 flex items-center gap-2">
                                    <span>{l.auction_house}</span>
                                    <span>&middot;</span>
                                    <span>{l.listing_type === 'AUCTION' ? 'Auction' : 'Buy Now'}</span>
                                    {l.listed_at && (
                                      <>
                                        <span>&middot;</span>
                                        <span>{formatDate(l.listed_at)}</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </a>
                            ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

