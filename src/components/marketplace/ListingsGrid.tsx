'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ListingCard } from './ListingCard'
import type { Listing, CardCondition } from '@/types/database'

const CONDITIONS: { value: CardCondition | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'near_mint', label: 'NM' },
  { value: 'lightly_played', label: 'LP' },
  { value: 'moderately_played', label: 'MP' },
  { value: 'heavily_played', label: 'HP' },
  { value: 'damaged', label: 'DMG' },
]

export function ListingsGrid({ cardId }: { cardId: string }) {
  const [listings, setListings] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)
  const [conditionFilter, setConditionFilter] = useState<CardCondition | 'all'>('all')

  useEffect(() => {
    async function fetchListings() {
      const supabase = createClient()
      let query = supabase
        .from('listings')
        .select('*, seller:profiles(*)')
        .eq('card_id', cardId)
        .eq('status', 'active')
        .order('price', { ascending: true })

      if (conditionFilter !== 'all') {
        query = query.eq('condition', conditionFilter)
      }

      const { data } = await query
      setListings((data as Listing[]) || [])
      setLoading(false)
    }
    fetchListings()
  }, [cardId, conditionFilter])

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-20 rounded-lg bg-zinc-100 animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div>
      {/* Condition filter */}
      <div className="flex items-center gap-2 mb-4">
        {CONDITIONS.map(c => (
          <button
            key={c.value}
            onClick={() => setConditionFilter(c.value)}
            className={`px-3 py-1 rounded-lg text-sm transition-colors cursor-pointer ${
              conditionFilter === c.value
                ? 'bg-orange-500 text-white'
                : 'bg-zinc-100 text-zinc-500 hover:text-zinc-700'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {listings.length === 0 ? (
        <div className="text-center py-8 text-zinc-500">
          <p>No listings available for this card yet.</p>
          <p className="text-sm mt-1">Be the first to list it!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {listings.map(listing => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}
    </div>
  )
}
