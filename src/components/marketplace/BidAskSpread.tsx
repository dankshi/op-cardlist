'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Bid, CardCondition } from '@/types/database'
import { CONDITION_LABELS, CONDITION_SHORT } from '@/types/database'

interface BidAskSpreadProps {
  cardId: string
}

export function BidAskSpread({ cardId }: BidAskSpreadProps) {
  const [bids, setBids] = useState<Bid[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [bidPrice, setBidPrice] = useState('')
  const [bidCondition, setBidCondition] = useState<CardCondition>('near_mint')
  const [submitting, setSubmitting] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [isSeller, setIsSeller] = useState(false)

  useEffect(() => {
    async function load() {
      const supabase = createClient()

      const { data: { user } } = await supabase.auth.getUser()
      setCurrentUserId(user?.id || null)

      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_seller, seller_approved')
          .eq('id', user.id)
          .single()
        setIsSeller(!!profile?.is_seller && !!profile?.seller_approved)
      }

      const bidRes = await fetch(`/api/bids?card_id=${encodeURIComponent(cardId)}`)
      const bidData = await bidRes.json()
      setBids(bidData.bids || [])

      setLoading(false)
    }
    load()
  }, [cardId])

  async function handlePlaceOffer(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    const res = await fetch('/api/bids', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        card_id: cardId,
        price: parseFloat(bidPrice),
        condition_min: bidCondition,
      }),
    })
    if (res.ok) {
      const newBid = await res.json()
      setBids(prev => [newBid, ...prev].sort((a, b) => Number(b.price) - Number(a.price)))
      setShowForm(false)
      setBidPrice('')
    }
    setSubmitting(false)
  }

  async function handleCancelOffer(bidId: string) {
    await fetch(`/api/bids?id=${bidId}`, { method: 'DELETE' })
    setBids(prev => prev.filter(b => b.id !== bidId))
  }

  function handleSellIntoOffer(bid: Bid) {
    if (!currentUserId) {
      window.location.href = '/auth/sign-in'
      return
    }
    if (!isSeller) {
      window.location.href = '/seller/apply'
      return
    }
    window.location.href = `/sell?card=${encodeURIComponent(cardId)}&price=${Number(bid.price).toFixed(2)}&condition=${bid.condition_min}`
  }

  if (loading) {
    return <div className="h-8 rounded bg-zinc-50 animate-pulse" />
  }

  return (
    <div>
      {/* Header row */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-zinc-700 uppercase tracking-wide">Offers</span>
          {bids.length > 0 && (
            <span className="text-[11px] text-zinc-400">({bids.length})</span>
          )}
        </div>
        {!showForm && (
          <button
            onClick={() => {
              if (!currentUserId) { window.location.href = '/auth/sign-in'; return }
              setShowForm(true)
            }}
            className="text-xs px-2.5 py-1 rounded-md bg-orange-50 text-orange-600 hover:bg-orange-100 font-medium transition-colors cursor-pointer"
          >
            + Make an Offer
          </button>
        )}
      </div>

      {/* Offer form */}
      {showForm && (
        <form onSubmit={handlePlaceOffer} className="mb-3 p-3 bg-zinc-50 border border-zinc-200 rounded-lg space-y-2.5">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 text-sm">$</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={bidPrice}
                onChange={e => setBidPrice(e.target.value)}
                required
                placeholder="0.00"
                className="w-full pl-6 pr-2 py-2 rounded-lg bg-white border border-zinc-200 text-zinc-900 text-sm focus:border-orange-300 focus:outline-none"
              />
            </div>
            <select
              value={bidCondition}
              onChange={e => setBidCondition(e.target.value as CardCondition)}
              className="px-3 py-2 rounded-lg bg-white border border-zinc-200 text-zinc-900 text-sm"
            >
              {Object.entries(CONDITION_SHORT).map(([value, label]) => (
                <option key={value} value={value}>{label}+</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {submitting ? 'Submitting...' : 'Place Offer'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 rounded-lg text-zinc-500 hover:text-zinc-700 text-sm border border-zinc-200 hover:border-zinc-300 transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Top 3 offers */}
      {bids.length > 0 ? (
        <div className="space-y-1.5">
          {bids.slice(0, 3).map((bid) => (
            <div key={bid.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-green-50/50 border border-green-100">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-green-600">
                  ${Number(bid.price).toFixed(2)}
                </span>
                <span className="text-xs text-zinc-500 px-1.5 py-0.5 bg-zinc-100 rounded">
                  {CONDITION_SHORT[bid.condition_min]}+
                </span>
              </div>
              <div className="flex items-center gap-2">
                {bid.user_id !== currentUserId && isSeller && (
                  <button
                    onClick={() => handleSellIntoOffer(bid)}
                    className="text-xs px-2.5 py-1 rounded-md bg-green-600 text-white font-medium hover:bg-green-700 transition-colors cursor-pointer"
                  >
                    Sell
                  </button>
                )}
                {bid.user_id === currentUserId && (
                  <button
                    onClick={() => handleCancelOffer(bid.id)}
                    className="text-xs text-red-400 hover:text-red-600 cursor-pointer"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))}
          {bids.length > 3 && (
            <p className="text-xs text-zinc-400 text-center pt-1">
              +{bids.length - 3} more offer{bids.length - 3 !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      ) : (
        !showForm && <p className="text-xs text-zinc-400 py-2">No offers yet. Be the first!</p>
      )}
    </div>
  )
}
