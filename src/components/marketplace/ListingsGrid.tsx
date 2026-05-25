'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ListingCard } from './ListingCard'
import { BidAskSpread } from './BidAskSpread'
import { BuyNowButton } from './BuyNowButton'
import { ConditionBadge } from './ConditionBadge'
import type { Listing, GradingCompany } from '@/types/database'

type TypeFilter = 'all' | 'raw' | 'graded'

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
  const [companyFilter, setCompanyFilter] = useState<GradingCompany | 'all'>('all')
  // Public-table query; no auth-lock risk, but hoisting createClient out
  // of the effect avoids allocating a fresh client per filter change.
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    async function fetchListings() {
      setLoading(true)
      try {
        let query = supabase
          .from('listings')
          .select('*')
          .eq('card_id', cardId)
          .eq('status', 'active')
          .order('price', { ascending: true })

        if (typeFilter === 'raw') {
          query = query.is('grading_company', null)
        } else if (typeFilter === 'graded') {
          query = query.not('grading_company', 'is', null)
          if (companyFilter !== 'all') {
            query = query.eq('grading_company', companyFilter)
          }
        }

        const { data } = await query
        setListings((data as Listing[]) || [])
      } catch (err) {
        console.error('[listings-grid] fetch failed', err)
        setListings([])
      } finally {
        setLoading(false)
      }
    }
    fetchListings()
  }, [cardId, typeFilter, companyFilter, supabase])

  return (
    <div>
      {/* Type filter: All / Raw / Graded */}
      <div className="flex items-center gap-1.5 mb-3">
        {(['all', 'raw', 'graded'] as TypeFilter[]).map(t => (
          <button
            key={t}
            onClick={() => {
              setTypeFilter(t)
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

      {/* Sub-filters for graded */}
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
        <>
          {/* Hero: the cheapest listing is the only one the buyer can act on.
              The rest become a passive price ladder underneath — context for
              "is this a good deal?" without a confusing wall of Buy buttons. */}
          <LowestListingCta listing={listings[0]} totalCount={listings.length} />

          {listings.length > 1 && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                Other listings
              </p>
              <div className="space-y-2">
                {listings.slice(1).map(listing => (
                  <ListingCard key={listing.id} listing={listing} />
                ))}
              </div>
            </div>
          )}
        </>
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

function LowestListingCta({ listing, totalCount }: { listing: Listing; totalCount: number }) {
  return (
    <div className="rounded-xl bg-gradient-to-br from-orange-50 to-amber-50 border-2 border-orange-200 p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <span className="text-[11px] font-bold uppercase tracking-wider text-orange-700">
          Lowest price{totalCount > 1 ? ` · ${totalCount} listings` : ''}
        </span>
        <ConditionBadge
          condition={listing.condition}
          gradingCompany={listing.grading_company}
          grade={listing.grade}
        />
      </div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-3xl font-bold text-zinc-900 tabular-nums leading-none">
            ${Number(listing.price).toFixed(2)}
          </p>
          {listing.quantity_available > 1 && (
            <p className="text-xs text-zinc-500 mt-1">{listing.quantity_available} available</p>
          )}
        </div>
        <BuyNowButton listingId={listing.id} price={Number(listing.price)} size="lg" />
      </div>
    </div>
  )
}
