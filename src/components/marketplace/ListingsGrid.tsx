'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ListingCard } from './ListingCard'
import { BidAskSpread } from './BidAskSpread'
import type { Listing, CardCondition, GradingCompany } from '@/types/database'

type TypeFilter = 'all' | 'raw' | 'graded'

const RAW_CONDITIONS: { value: CardCondition | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'near_mint', label: 'NM' },
  { value: 'lightly_played', label: 'LP' },
  { value: 'damaged', label: 'DMG' },
]

const GRADING_COMPANIES: { value: GradingCompany | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'PSA', label: 'PSA' },
  { value: 'CGC', label: 'CGC' },
  { value: 'BGS', label: 'BGS' },
  { value: 'TAG', label: 'TAG' },
]

export function ListingsGrid({ cardId }: { cardId: string }) {
  const [listings, setListings] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [conditionFilter, setConditionFilter] = useState<CardCondition | 'all'>('all')
  const [companyFilter, setCompanyFilter] = useState<GradingCompany | 'all'>('all')

  useEffect(() => {
    async function fetchListings() {
      setLoading(true)
      const supabase = createClient()
      let query = supabase
        .from('listings')
        .select('*')
        .eq('card_id', cardId)
        .eq('status', 'active')
        .order('price', { ascending: true })

      if (typeFilter === 'raw') {
        query = query.is('grading_company', null)
        if (conditionFilter !== 'all') {
          query = query.eq('condition', conditionFilter)
        }
      } else if (typeFilter === 'graded') {
        query = query.not('grading_company', 'is', null)
        if (companyFilter !== 'all') {
          query = query.eq('grading_company', companyFilter)
        }
      }

      const { data } = await query
      setListings((data as Listing[]) || [])
      setLoading(false)
    }
    fetchListings()
  }, [cardId, typeFilter, conditionFilter, companyFilter])

  return (
    <div>
      {/* Type filter: All / Raw / Graded */}
      <div className="flex items-center gap-1.5 mb-3">
        {(['all', 'raw', 'graded'] as TypeFilter[]).map(t => (
          <button
            key={t}
            onClick={() => {
              setTypeFilter(t)
              setConditionFilter('all')
              setCompanyFilter('all')
            }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
              typeFilter === t
                ? 'bg-orange-500 text-white'
                : 'bg-zinc-100 text-zinc-500 hover:text-zinc-700'
            }`}
          >
            {t === 'all' ? 'All' : t === 'raw' ? 'Raw' : 'Graded'}
          </button>
        ))}
      </div>

      {/* Sub-filters */}
      {typeFilter === 'raw' && (
        <div className="flex items-center gap-1.5 mb-3">
          {RAW_CONDITIONS.map(c => (
            <button
              key={c.value}
              onClick={() => setConditionFilter(c.value)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                conditionFilter === c.value
                  ? 'bg-zinc-700 text-white'
                  : 'bg-zinc-50 text-zinc-400 hover:text-zinc-600 border border-zinc-200'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {typeFilter === 'graded' && (
        <div className="flex items-center gap-1.5 mb-3">
          {GRADING_COMPANIES.map(c => (
            <button
              key={c.value}
              onClick={() => setCompanyFilter(c.value)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                companyFilter === c.value
                  ? 'bg-zinc-700 text-white'
                  : 'bg-zinc-50 text-zinc-400 hover:text-zinc-600 border border-zinc-200'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {/* Listings */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 rounded-lg bg-zinc-100 animate-pulse" />
          ))}
        </div>
      ) : listings.length === 0 ? (
        <div className="text-center py-8 text-zinc-500">
          <p>No listings available{typeFilter !== 'all' ? ` for ${typeFilter} cards` : ''} yet.</p>
          <p className="text-sm mt-1">Be the first to list it!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {listings.map(listing => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}

      {/* Offers — hidden when graded filter is active */}
      {typeFilter !== 'graded' && (
        <div className="mt-4 pt-4 border-t border-zinc-100">
          <BidAskSpread cardId={cardId} />
        </div>
      )}
    </div>
  )
}
