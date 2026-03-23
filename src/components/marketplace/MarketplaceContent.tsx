'use client'

import { useState, useMemo, useCallback } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { ConditionBadge } from './ConditionBadge'
import { BuyNowButton } from './BuyNowButton'
import { GRADING_SCALES } from '@/types/database'
import type { GradingCompany } from '@/types/database'
import type { EnrichedListing } from '@/components/home/ListingCarousel'

const QUICK_FILTERS = [
  { label: 'PSA 10', company: 'PSA', grade: '10' },
  { label: 'PSA 9', company: 'PSA', grade: '9' },
  { label: 'BGS 10', company: 'BGS', grade: '10' },
  { label: 'BGS Black Label', company: 'BGS', grade: 'Black Label 10' },
  { label: 'BGS 9.5', company: 'BGS', grade: '9.5' },
  { label: 'CGC 10', company: 'CGC', grade: '10' },
  { label: 'CGC 9.5', company: 'CGC', grade: '9.5' },
  { label: 'Raw / Ungraded', company: 'raw', grade: null },
]

const COMPANIES = ['all', 'PSA', 'CGC', 'BGS', 'TAG', 'raw'] as const
const SORT_OPTIONS = [
  { value: 'price_asc', label: 'Price: Low \u2192 High' },
  { value: 'price_desc', label: 'Price: High \u2192 Low' },
  { value: 'newest', label: 'Newest' },
]

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

function sortGroupedCards(groups: GroupedCard[], sortBy: string): GroupedCard[] {
  return [...groups].sort((a, b) => {
    if (sortBy === 'price_asc') return a.cheapestListing.price - b.cheapestListing.price
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

  // Filters
  const [activeQuickFilter, setActiveQuickFilter] = useState<string | null>(null)
  const [company, setCompany] = useState('all')
  const [grade, setGrade] = useState('all')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [sort, setSort] = useState('price_asc')
  const [search, setSearch] = useState('')

  // Group and sort listings (recomputes when allListings or sort changes)
  const groupedCards = useMemo(() => {
    const groups = groupListingsByCard(allListings)
    return sortGroupedCards(groups, sort)
  }, [allListings, sort])

  const visibleCards = groupedCards.slice(0, displayCount)
  const totalCards = groupedCards.length

  const enrichListings = useCallback((rawListings: any[]): EnrichedListing[] => {
    return rawListings
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

  function handleSortChange(newSort: string) {
    setSort(newSort)
    // Re-sorting happens client-side via useMemo — no refetch needed
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

  const hasFilters = company !== 'all' || grade !== 'all' || minPrice || maxPrice || search || activeQuickFilter
  const gradeOptions = company !== 'all' && company !== 'raw' ? GRADING_SCALES[company as GradingCompany] : null

  return (
    <div>
      {/* Quick filter pills */}
      <div className="flex flex-wrap gap-2 mb-6">
        {QUICK_FILTERS.map(qf => (
          <button
            key={qf.label}
            onClick={() => handleQuickFilter(qf.label, qf.company, qf.grade)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors cursor-pointer ${
              activeQuickFilter === qf.label
                ? 'bg-orange-500 text-white'
                : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
            }`}
          >
            {qf.label}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="bg-white border border-zinc-200 rounded-lg p-4 mb-6 space-y-4">
        {/* Search */}
        <div>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearchSubmit()}
            placeholder="Search by card name..."
            className="w-full px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-200 text-zinc-900 text-sm placeholder-zinc-400"
          />
        </div>

        {/* Company filter */}
        <div>
          <p className="text-xs text-zinc-500 mb-2 font-medium">Grading Company</p>
          <div className="flex flex-wrap gap-1.5">
            {COMPANIES.map(c => (
              <button
                key={c}
                onClick={() => handleCompanyChange(c)}
                className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  company === c
                    ? 'bg-orange-500 text-white'
                    : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                }`}
              >
                {c === 'all' ? 'All' : c === 'raw' ? 'Raw' : c}
              </button>
            ))}
          </div>
        </div>

        {/* Grade filter (dynamic) */}
        {gradeOptions && (
          <div>
            <p className="text-xs text-zinc-500 mb-2 font-medium">Grade</p>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => handleGradeChange('all')}
                className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  grade === 'all'
                    ? 'bg-orange-500 text-white'
                    : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                }`}
              >
                All
              </button>
              {gradeOptions.map(g => (
                <button
                  key={g}
                  onClick={() => handleGradeChange(g)}
                  className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    grade === g
                      ? 'bg-orange-500 text-white'
                      : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Price range + Sort */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex items-center gap-2">
            <div>
              <p className="text-xs text-zinc-500 mb-1 font-medium">Min Price</p>
              <input
                type="number"
                value={minPrice}
                onChange={e => setMinPrice(e.target.value)}
                placeholder="$0"
                className="w-24 px-3 py-1.5 rounded-lg bg-zinc-50 border border-zinc-200 text-zinc-900 text-sm"
              />
            </div>
            <span className="text-zinc-400 mt-5">&mdash;</span>
            <div>
              <p className="text-xs text-zinc-500 mb-1 font-medium">Max Price</p>
              <input
                type="number"
                value={maxPrice}
                onChange={e => setMaxPrice(e.target.value)}
                placeholder="$999"
                className="w-24 px-3 py-1.5 rounded-lg bg-zinc-50 border border-zinc-200 text-zinc-900 text-sm"
              />
            </div>
            <button
              onClick={applyPriceFilter}
              className="mt-5 px-3 py-1.5 rounded-lg bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              Apply
            </button>
          </div>

          <div className="ml-auto">
            <p className="text-xs text-zinc-500 mb-1 font-medium">Sort</p>
            <select
              value={sort}
              onChange={e => handleSortChange(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-zinc-50 border border-zinc-200 text-zinc-900 text-sm cursor-pointer"
            >
              {SORT_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Active filters summary */}
        {hasFilters && (
          <div className="flex items-center gap-2 pt-2 border-t border-zinc-100">
            <span className="text-xs text-zinc-500">{totalCards} card{totalCards !== 1 ? 's' : ''} found</span>
            <button
              onClick={clearFilters}
              className="text-xs text-orange-500 hover:text-orange-600 font-medium cursor-pointer"
            >
              Clear all filters
            </button>
          </div>
        )}
      </div>

      {/* Results */}
      {loading ? (
        <div className="py-20 text-center">
          <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : groupedCards.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-zinc-500 mb-2">No listings found</p>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="text-orange-500 hover:text-orange-600 text-sm font-medium cursor-pointer"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          {!hasFilters && (
            <p className="text-sm text-zinc-500 mb-4">{totalCards} card{totalCards !== 1 ? 's' : ''} available</p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {visibleCards.map(group => (
              <div
                key={group.card_id}
                className="bg-white border border-zinc-200 rounded-lg overflow-hidden hover:border-zinc-300 transition-colors"
              >
                <Link href={`/card/${group.card_id.toLowerCase()}`}>
                  <div className="aspect-[5/7] bg-zinc-50 relative">
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
                <div className="p-3">
                  <Link href={`/card/${group.card_id.toLowerCase()}`}>
                    <p className="text-sm font-medium text-zinc-900 truncate hover:text-orange-500 transition-colors">
                      {group.cardName}
                    </p>
                  </Link>
                  <div className="mt-1 flex items-center gap-2">
                    <ConditionBadge
                      condition={group.cheapestListing.condition}
                      gradingCompany={group.cheapestListing.grading_company}
                      grade={group.cheapestListing.grade}
                    />
                    {group.listingCount > 1 && (
                      <span className="text-xs text-zinc-400">{group.listingCount} listings</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div>
                      {group.listingCount > 1 && (
                        <p className="text-[10px] text-zinc-400 leading-none mb-0.5">from</p>
                      )}
                      <p className="text-lg font-bold text-zinc-900">${Number(group.cheapestListing.price).toFixed(2)}</p>
                    </div>
                    <BuyNowButton listingId={group.cheapestListing.id} price={group.cheapestListing.price} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Load More */}
          {visibleCards.length < totalCards && (
            <div className="text-center mt-8">
              <button
                onClick={loadMore}
                className="px-6 py-2.5 rounded-lg bg-zinc-900 text-white font-medium hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                Load More ({visibleCards.length} of {totalCards})
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
