'use client'

/* eslint-disable @next/next/no-img-element */
import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { Bid } from '@/types/database'

interface Props {
  offers: Bid[]
  /** card_id → image URL. Parent fetches once on mount and passes through. */
  cardImages: Record<string, string>
  /** card_id → display name. Optional; falls back to the card_id. */
  cardNames?: Record<string, string>
  /** Notify parent when an offer is cancelled so the offers count + stats
   *  on /mystuff stay in sync without a full reload. */
  onOffersChange: (next: Bid[]) => void
}

/** Compact tile label for a bid's variant — "Raw" or "PSA 10". The same
 *  string is used in the section header on the public BidAskSpread. */
function variantLabel(bid: Pick<Bid, 'grading_company' | 'grade'>): string {
  if (!bid.grading_company || !bid.grade) return 'Raw'
  return `${bid.grading_company} ${bid.grade}`
}

function daysUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24))
  if (days <= 0) return 'expires soon'
  if (days === 1) return 'expires tomorrow'
  return `expires in ${days}d`
}

/** Buyer-side companion to StorefrontGrid: shows the user's own open
 *  offers as tiles with a cancel affordance. Sold-into or expired offers
 *  drop out via the parent's status filter (`status = 'active'`). */
export function MyOffersGrid({ offers, cardImages, cardNames, onOffersChange }: Props) {
  const [query, setQuery] = useState('')

  const visible = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return offers
      .filter(b => {
        if (tokens.length === 0) return true
        const name = (cardNames?.[b.card_id] ?? '').toLowerCase()
        const variant = variantLabel(b).toLowerCase()
        const haystack = `${b.card_id} ${name} ${variant}`.toLowerCase()
        return tokens.every(t => haystack.includes(t))
      })
      .sort((a, b) => Number(b.price) - Number(a.price))
  }, [offers, query, cardNames])

  async function handleCancel(id: string) {
    if (!confirm('Cancel this offer?')) return
    const res = await fetch(`/api/bids?id=${id}`, { method: 'DELETE' })
    if (!res.ok) {
      alert('Failed to cancel offer.')
      return
    }
    onOffersChange(offers.filter(o => o.id !== id))
  }

  if (offers.length === 0) {
    return (
      <div className="text-center py-16 text-zinc-500">
        <p>No open offers yet.</p>
        <Link
          href="/marketplace"
          className="mt-3 inline-block text-orange-500 hover:text-orange-600 font-medium"
        >
          Browse cards to make an offer →
        </Link>
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[240px]">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
          </svg>
          <input
            type="text"
            placeholder="Search your offers…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full pl-10 pr-9 py-2.5 bg-white border border-zinc-200 rounded-lg text-zinc-900 placeholder:text-zinc-400 text-sm focus:outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900/5 transition-all"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 inline-flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <p className="text-xs text-zinc-500 mb-4">
        Showing {visible.length} of {offers.length} open offer{visible.length === 1 ? '' : 's'}.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-x-4 gap-y-6">
        {visible.map(offer => {
          const variant = variantLabel(offer)
          const isGraded = !!offer.grading_company
          return (
            <div key={offer.id} className="block group">
              <Link href={`/card/${offer.card_id.toLowerCase()}`} className="block">
                <div className="aspect-[2.5/3.5] relative rounded-lg overflow-hidden bg-zinc-100 ring-1 ring-zinc-100 group-hover:ring-zinc-300 transition-all">
                  {cardImages[offer.card_id] ? (
                    <img
                      src={cardImages[offer.card_id]}
                      alt={cardNames?.[offer.card_id] ?? offer.card_id}
                      className="absolute inset-0 w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-zinc-400 text-xs">
                      no image
                    </div>
                  )}
                  {/* Variant pill — top-left so it's the first thing the
                      eye lands on after the image. Green for graded so
                      a glance distinguishes slab offers from raw NM. */}
                  <span className={`absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                    isGraded
                      ? 'bg-emerald-500/95 text-white'
                      : 'bg-white/95 text-zinc-700 ring-1 ring-zinc-200'
                  }`}>
                    {variant}
                  </span>
                </div>
              </Link>

              <div className="mt-2 flex items-end justify-between gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500 font-semibold">
                    Your offer
                  </div>
                  <div className="text-lg font-semibold tabular-nums text-emerald-600 mt-0.5">
                    ${Number(offer.price).toFixed(2)}
                  </div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">
                    {daysUntil(offer.expires_at)}
                  </div>
                </div>
                <button
                  onClick={() => handleCancel(offer.id)}
                  className="text-xs px-2.5 py-1 rounded-md text-red-500 hover:text-red-700 hover:bg-red-50 transition-colors cursor-pointer"
                  title="Cancel this offer"
                >
                  Cancel
                </button>
              </div>
              <Link
                href={`/card/${offer.card_id.toLowerCase()}`}
                className="block text-xs text-zinc-700 hover:text-orange-600 mt-1 font-medium truncate transition-colors"
                title={cardNames?.[offer.card_id] ?? offer.card_id}
              >
                {cardNames?.[offer.card_id] ?? offer.card_id}
              </Link>
              <p className="text-[11px] text-zinc-400 font-mono">{offer.card_id}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
