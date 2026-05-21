'use client'

import { useState, useMemo, useCallback } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { ConditionBadge } from './ConditionBadge'
import { BuyNowButton } from './BuyNowButton'
import { PriceRow } from '../card/PriceRow'
import { GRADING_SCALES } from '@/types/database'
import type { GradingCompany } from '@/types/database'
import type { EnrichedListing } from '@/components/home/ListingCarousel'

const QUICK_FILTERS = [
  { label: 'PSA 10',         company: 'PSA', grade: '10' },
  { label: 'PSA 9',          company: 'PSA', grade: '9' },
  { label: 'BGS 10',         company: 'BGS', grade: '10' },
  { label: 'BGS BL',         company: 'BGS', grade: 'Black Label 10' },
  { label: 'BGS 9.5',        company: 'BGS', grade: '9.5' },
  { label: 'CGC 10',         company: 'CGC', grade: '10' },
  { label: 'CGC 9.5',        company: 'CGC', grade: '9.5' },
  { label: 'Raw / Ungraded', company: 'raw', grade: null as string | null },
]

const COMPANIES = ['all', 'PSA', 'CGC', 'BGS', 'TAG', 'raw'] as const
const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: 'price_asc',  label: 'Price: Low → High' },
  { value: 'price_desc', label: 'Price: High → Low' },
  { value: 'newest',     label: 'Newest first' },
]

type SortOption = 'price_asc' | 'price_desc' | 'newest'

const PAGE_SIZE = 24

interface GroupedCard {
  card_id: string
  cardName: string
  cardImageUrl: string
  cheapestListing: EnrichedListing
  listingCount: number
  newestDate: string
}

function groupListingsByCard(listings: EnrichedListing[]): GroupedCard[] {
  const groups = new Map<string, EnrichedListing[]>()

  for (const listing of listings) {
    const existing = groups.get(listing.card_id)
    if (existing) {
      existing.push(listing)
    } else {
      groups.set(listing.card_id, [listing])
    }
  }

  return Array.from(groups.entries()).map(([card_id, cardListings]) => {
    const cheapest = cardListings.reduce((min, l) => l.price < min.price ? l : min, cardListings[0])
    const newest = cardListings.reduce((max, l) =>
      new Date(l.createdAt).getTime() > new Date(max.createdAt).getTime() ? l : max, cardListings[0])
    return {
      card_id,
      cardName: cheapest.cardName,
      cardImageUrl: cheapest.cardImageUrl,
      cheapestListing: cheapest,
      listingCount: cardListings.length,
      newestDate: newest.createdAt,
    }
  })
}

function sortGroupedCards(groups: GroupedCard[], sortBy: SortOption): GroupedCard[] {
  return [...groups].sort((a, b) => {
    if (sortBy === 'price_asc')  return a.cheapestListing.price - b.cheapestListing.price
    if (sortBy === 'price_desc') return b.cheapestListing.price - a.cheapestListing.price
    return new Date(b.newestDate).getTime() - new Date(a.newestDate).getTime()
  })
}

interface MarketplaceContentProps {
  initialListings: EnrichedListing[]
  cardMap: Record<string, { name: string; imageUrl: string }>
}

export function MarketplaceContent({ initialListings, cardMap }: MarketplaceContentProps) {
  const [allListings, setAllListings] = useState(initialListings)
  const [loading, setLoading] = useState(false)
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)

  // Filters
  const [activeQuickFilter, setActiveQuickFilter] = useState<string | null>(null)
  const [company, setCompany] = useState('all')
  const [grade, setGrade] = useState('all')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [sort, setSort] = useState<SortOption>('price_asc')
  const [search, setSearch] = useState('')

  const groupedCards = useMemo(() => {
    const groups = groupListingsByCard(allListings)
    return sortGroupedCards(groups, sort)
  }, [allListings, sort])

  const visibleCards = groupedCards.slice(0, displayCount)
  const totalCards = groupedCards.length

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enrichListings = useCallback((rawListings: any[]): EnrichedListing[] => {
    return rawListings
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((listing: any) => {
        const card = cardMap[listing.card_id]
        if (!card) return null
        return {
          id: listing.id,
          card_id: listing.card_id,
          cardName: card.name,
          cardImageUrl: card.imageUrl,
          price: listing.price,
          condition: listing.condition,
          grading_company: listing.grading_company || null,
          grade: listing.grade || null,
          createdAt: listing.created_at,
        } as EnrichedListing
      })
      .filter((l: EnrichedListing | null): l is EnrichedListing => l !== null)
  }, [cardMap])

  async function fetchFiltered(params: URLSearchParams) {
    setLoading(true)
    params.set('limit', '500')
    params.set('offset', '0')
    params.set('sort', 'price_asc')

    const res = await fetch(`/api/listings?${params}`)
    const data = await res.json()
    setAllListings(enrichListings(data.listings || []))
    setDisplayCount(PAGE_SIZE)
    setLoading(false)
  }

  function buildFilterParams(overrideCompany?: string, overrideGrade?: string) {
    const params = new URLSearchParams()
    const c = overrideCompany ?? company
    const g = overrideGrade ?? grade
    if (c !== 'all') params.set('grading_company', c)
    if (g !== 'all') params.set('grade', g)
    if (minPrice) params.set('min_price', minPrice)
    if (maxPrice) params.set('max_price', maxPrice)
    if (search.trim()) params.set('search', search.trim())
    return params
  }

  function handleQuickFilter(label: string, qfCompany: string, qfGrade: string | null) {
    if (activeQuickFilter === label) {
      setActiveQuickFilter(null)
      setCompany('all')
      setGrade('all')
      fetchFiltered(buildFilterParams('all', 'all'))
    } else {
      setActiveQuickFilter(label)
      setCompany(qfCompany)
      setGrade(qfGrade || 'all')
      fetchFiltered(buildFilterParams(qfCompany, qfGrade || 'all'))
    }
  }

  function handleCompanyChange(newCompany: string) {
    setActiveQuickFilter(null)
    setCompany(newCompany)
    setGrade('all')
    fetchFiltered(buildFilterParams(newCompany, 'all'))
  }

  function handleGradeChange(newGrade: string) {
    setActiveQuickFilter(null)
    setGrade(newGrade)
    fetchFiltered(buildFilterParams(company, newGrade))
  }

  function applyPriceFilter() {
    fetchFiltered(buildFilterParams())
  }

  function handleSearchSubmit() {
    fetchFiltered(buildFilterParams())
  }

  function clearFilters() {
    setActiveQuickFilter(null)
    setCompany('all')
    setGrade('all')
    setMinPrice('')
    setMaxPrice('')
    setSearch('')
    setSort('price_asc')
    fetchFiltered(new URLSearchParams())
  }

  function loadMore() {
    setDisplayCount(prev => prev + PAGE_SIZE)
  }

  const hasFilters = company !== 'all' || grade !== 'all' || Boolean(minPrice) || Boolean(maxPrice) || Boolean(search) || activeQuickFilter !== null
  const gradeOptions = company !== 'all' && company !== 'raw' ? GRADING_SCALES[company as GradingCompany] : null
  const activeFilterCount =
    (company !== 'all' ? 1 : 0) +
    (grade !== 'all' ? 1 : 0) +
    ((minPrice || maxPrice) ? 1 : 0)

  const filterPanelProps = {
    company,
    grade,
    minPrice,
    maxPrice,
    gradeOptions,
    onCompanyChange: handleCompanyChange,
    onGradeChange: handleGradeChange,
    onMinPriceChange: setMinPrice,
    onMaxPriceChange: setMaxPrice,
    onApplyPrice: applyPriceFilter,
    onClear: clearFilters,
    hasFilters,
  }

  return (
    <div>
      {/* Search bar — full width */}
      <div className="relative mb-6">
        <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearchSubmit()}
          placeholder="Search listings by card name…"
          className="w-full pl-11 pr-10 py-3 bg-white border border-zinc-200 rounded-lg text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900/5 transition-all"
        />
        {search && (
          <button
            onClick={() => { setSearch(''); fetchFiltered(buildFilterParams()) }}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 inline-flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
          >
            &times;
          </button>
        )}
      </div>

      {/* Quick-filter chips */}
      <div className="flex flex-wrap gap-2 mb-6">
        {QUICK_FILTERS.map(qf => {
          const active = activeQuickFilter === qf.label
          return (
            <button
              key={qf.label}
              onClick={() => handleQuickFilter(qf.label, qf.company, qf.grade)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer ${
                active
                  ? 'bg-zinc-900 text-white'
                  : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:ring-zinc-400'
              }`}
            >
              {qf.label}
            </button>
          )
        })}
      </div>

      {/* Sidebar + Grid */}
      <div className="flex gap-8">
        {/* Desktop sidebar */}
        <aside className="hidden md:block w-60 shrink-0">
          <FilterPanel {...filterPanelProps} />
        </aside>

        {/* Main column */}
        <div className="flex-1 min-w-0">
          {/* Results header */}
          <div className="flex items-center justify-between gap-3 mb-4 pb-4 border-b border-zinc-200">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(true)}
                className="md:hidden inline-flex items-center gap-2 px-3 py-2 rounded-md border border-zinc-200 bg-white text-sm font-medium text-zinc-900 hover:border-zinc-400 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 5h18M6 12h12M10 19h4" />
                </svg>
                Filters
                {activeFilterCount > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-zinc-900 text-white text-[11px] font-semibold">
                    {activeFilterCount}
                  </span>
                )}
              </button>
              <p className="text-sm text-zinc-500 truncate">
                <span className="font-medium text-zinc-900 tabular-nums">{totalCards}</span>{' '}
                {totalCards === 1 ? 'card' : 'cards'} available
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <label htmlFor="mp-sort" className="hidden sm:block text-xs uppercase tracking-wider text-zinc-500 font-medium">
                Sort
              </label>
              <div className="relative">
                <select
                  id="mp-sort"
                  value={sort}
                  onChange={e => setSort(e.target.value as SortOption)}
                  className="appearance-none pl-3 pr-8 py-2 rounded-md border border-zinc-200 bg-white text-sm font-medium text-zinc-900 hover:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/5 transition-colors cursor-pointer"
                >
                  {SORT_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>

          {/* Results */}
          {loading ? (
            <div className="py-20 text-center">
              <div className="w-8 h-8 border-2 border-zinc-900 border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          ) : groupedCards.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-zinc-500 mb-2">No listings found</p>
              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="text-orange-600 hover:text-orange-700 text-sm font-medium cursor-pointer"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-6">
                {visibleCards.map(group => (
                  <div key={group.card_id} className="group block">
                    <Link href={`/card/${group.card_id.toLowerCase()}`} className="block">
                      <div className="aspect-[2.5/3.5] relative rounded-lg overflow-hidden bg-zinc-100 ring-1 ring-zinc-200 group-hover:ring-zinc-300 transition-all">
                        {group.cardImageUrl ? (
                          <Image
                            src={group.cardImageUrl}
                            alt={group.cardName}
                            fill
                            className="object-cover"
                            unoptimized
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-12 h-12 rounded-full bg-zinc-100" />
                          </div>
                        )}
                      </div>
                    </Link>
                    <PriceRow
                      price={Number(group.cheapestListing.price)}
                      label={
                        <ConditionBadge
                          condition={group.cheapestListing.condition}
                          gradingCompany={group.cheapestListing.grading_company}
                          grade={group.cheapestListing.grade}
                        />
                      }
                      trailing={
                        <BuyNowButton
                          listingId={group.cheapestListing.id}
                          price={group.cheapestListing.price}
                        />
                      }
                      footer={
                        <Link
                          href={`/card/${group.card_id.toLowerCase()}`}
                          className="hover:text-zinc-700 transition-colors"
                        >
                          {group.cardName}
                          {group.listingCount > 1 && (
                            <span className="text-zinc-400">{' '}· {group.listingCount} listings</span>
                          )}
                        </Link>
                      }
                    />
                  </div>
                ))}
              </div>

              {/* Load More */}
              {visibleCards.length < totalCards && (
                <div className="text-center mt-10">
                  <button
                    onClick={loadMore}
                    className="px-6 py-2.5 rounded-lg bg-zinc-900 text-white font-medium hover:bg-zinc-800 transition-colors cursor-pointer"
                  >
                    Load more <span className="text-zinc-400 ml-1">({visibleCards.length} of {totalCards})</span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Mobile filter bottom-sheet */}
      {mobileFiltersOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-zinc-900/50"
            onClick={() => setMobileFiltersOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] bg-white rounded-t-2xl shadow-xl flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-zinc-200">
              <h3 className="text-base font-semibold text-zinc-900">Filters</h3>
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                aria-label="Close filters"
                className="w-8 h-8 inline-flex items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100"
              >
                &times;
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <FilterPanel {...filterPanelProps} />
            </div>
            <div className="p-4 border-t border-zinc-200 bg-zinc-50">
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                className="w-full py-3 rounded-md bg-zinc-900 text-white font-semibold text-sm hover:bg-zinc-800 transition-colors"
              >
                Show {totalCards} {totalCards === 1 ? 'card' : 'cards'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface FilterPanelProps {
  company: string
  grade: string
  minPrice: string
  maxPrice: string
  gradeOptions: string[] | null
  onCompanyChange: (c: string) => void
  onGradeChange: (g: string) => void
  onMinPriceChange: (v: string) => void
  onMaxPriceChange: (v: string) => void
  onApplyPrice: () => void
  onClear: () => void
  hasFilters: boolean
}

function FilterPanel({
  company,
  grade,
  minPrice,
  maxPrice,
  gradeOptions,
  onCompanyChange,
  onGradeChange,
  onMinPriceChange,
  onMaxPriceChange,
  onApplyPrice,
  onClear,
  hasFilters,
}: FilterPanelProps) {
  return (
    <div className="space-y-6">
      <section>
        <h4 className="text-[11px] uppercase tracking-[0.14em] text-zinc-500 font-semibold mb-3">
          Grading Company
        </h4>
        <div className="space-y-1">
          {COMPANIES.map(c => {
            const selected = company === c
            const label = c === 'all' ? 'All companies' : c === 'raw' ? 'Raw / Ungraded' : c
            return (
              <button
                key={c}
                type="button"
                onClick={() => onCompanyChange(c)}
                className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-sm transition-colors ${
                  selected
                    ? 'bg-zinc-900 text-white'
                    : 'text-zinc-700 hover:bg-zinc-100'
                }`}
              >
                <span>{label}</span>
                {selected && (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      </section>

      {gradeOptions && (
        <>
          <div className="border-t border-zinc-200" />
          <section>
            <h4 className="text-[11px] uppercase tracking-[0.14em] text-zinc-500 font-semibold mb-3">
              Grade
            </h4>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => onGradeChange('all')}
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  grade === 'all'
                    ? 'bg-zinc-900 text-white'
                    : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:ring-zinc-400'
                }`}
              >
                All
              </button>
              {gradeOptions.map(g => (
                <button
                  key={g}
                  type="button"
                  onClick={() => onGradeChange(g)}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    grade === g
                      ? 'bg-zinc-900 text-white'
                      : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:ring-zinc-400'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </section>
        </>
      )}

      <div className="border-t border-zinc-200" />

      <section>
        <h4 className="text-[11px] uppercase tracking-[0.14em] text-zinc-500 font-semibold mb-3">
          Price range
        </h4>
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 text-sm">$</span>
            <input
              type="number"
              value={minPrice}
              onChange={e => onMinPriceChange(e.target.value)}
              placeholder="Min"
              className="w-full pl-6 pr-2 py-2 rounded-md bg-white border border-zinc-200 text-zinc-900 text-sm focus:outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900/5"
            />
          </div>
          <span className="text-zinc-400">&ndash;</span>
          <div className="relative flex-1 min-w-0">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 text-sm">$</span>
            <input
              type="number"
              value={maxPrice}
              onChange={e => onMaxPriceChange(e.target.value)}
              placeholder="Max"
              className="w-full pl-6 pr-2 py-2 rounded-md bg-white border border-zinc-200 text-zinc-900 text-sm focus:outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900/5"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={onApplyPrice}
          className="mt-3 w-full py-2 rounded-md bg-zinc-100 text-zinc-900 text-sm font-medium hover:bg-zinc-200 transition-colors"
        >
          Apply price range
        </button>
      </section>

      {hasFilters && (
        <>
          <div className="border-t border-zinc-200" />
          <button
            type="button"
            onClick={onClear}
            className="text-sm text-zinc-500 hover:text-zinc-900 transition-colors"
          >
            Clear all filters
          </button>
        </>
      )}
    </div>
  )
}
