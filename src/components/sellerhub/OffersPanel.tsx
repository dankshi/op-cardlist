'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { calculatePayout } from '@/lib/fees'
import { AcceptOfferModal } from '@/components/card/AcceptOfferModal'
import type { Bid, Listing, SellerTier } from '@/types/database'

interface Props {
  listings: Listing[]
  userId: string
  cardImages: Record<string, string>
  cardNames: Record<string, string>
  tier: SellerTier
}

function variantLabel(b: Bid): string {
  return b.grading_company ? `${b.grading_company} ${b.grade}` : 'Raw NM'
}

function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000))
}

/** Highest open offers the seller can fulfill — scoped to cards they
 *  currently have listed. Accepting captures the buyer's pre-auth and
 *  creates the order (reuses AcceptOfferModal → /api/bids/[id]/accept). */
export function OffersPanel({ listings, userId, cardImages, cardNames, tier }: Props) {
  const [bids, setBids] = useState<Bid[]>([])
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState<Bid | null>(null)

  // Distinct cards the seller actively lists — the set of offers they can
  // realistically fulfill from inventory.
  const cardIds = useMemo(
    () => [...new Set(listings.filter(l => l.status === 'active').map(l => l.card_id))],
    [listings],
  )

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      if (cardIds.length === 0) { setBids([]); setLoading(false); return }
      try {
        const results = await Promise.all(
          cardIds.map(id =>
            fetch(`/api/bids?card_id=${encodeURIComponent(id)}&limit=10`)
              .then(r => r.ok ? r.json() : { bids: [] })
              .catch(() => ({ bids: [] })),
          ),
        )
        if (cancelled) return
        const merged: Bid[] = results.flatMap(r => (r.bids as Bid[]) || [])
        // Drop the seller's own offers, then sort best-first.
        const actionable = merged
          .filter(b => b.user_id !== userId)
          .sort((a, b) => Number(b.price) - Number(a.price))
        setBids(actionable)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [cardIds, userId])

  if (loading) {
    return (
      <div className="py-16 text-center">
        <div className="w-7 h-7 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  if (bids.length === 0) {
    return (
      <div className="bg-white border border-zinc-200 rounded-xl p-12 text-center text-sm text-zinc-500">
        No open offers on the cards you&apos;re currently selling.
      </div>
    )
  }

  return (
    <>
      <p className="text-sm text-zinc-500 mb-3">
        Open offers on cards you list. Accepting commits you to shipping the matching card to Nomi.
      </p>
      <div className="overflow-x-auto bg-white border border-zinc-200 rounded-xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500">
              <th className="px-3 py-2.5">Card</th>
              <th className="px-3 py-2.5">Variant</th>
              <th className="px-3 py-2.5 text-right">Offer</th>
              <th className="px-3 py-2.5 text-right">Est. payout</th>
              <th className="px-3 py-2.5">Buyer</th>
              <th className="px-3 py-2.5">Expires</th>
              <th className="px-3 py-2.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {bids.map(b => {
              const payout = calculatePayout({
                salePrice: Number(b.price),
                fulfillment: 'ship',
                tier,
                isRaw: !b.grading_company,
              }).payout
              const name = cardNames[b.card_id] || b.card_id
              const img = cardImages[b.card_id]
              const canFastAccept = !!b.stripe_payment_intent_id
              return (
                <tr key={b.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50/60">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2 min-w-[180px]">
                      <div className="relative w-8 h-11 shrink-0 rounded bg-zinc-100 overflow-hidden">
                        {img && <Image src={img} alt="" fill sizes="32px" className="object-cover" unoptimized />}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-zinc-900 truncate max-w-[200px]">{name}</p>
                        <p className="text-xs text-zinc-400">{b.card_id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-zinc-600">{variantLabel(b)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-zinc-900">${Number(b.price).toFixed(2)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-700">${payout.toFixed(2)}</td>
                  <td className="px-3 py-2 text-zinc-600">
                    {b.user?.display_name || b.user?.username || 'Buyer'}
                    {b.user?.rating_avg != null && b.user.rating_count! > 0 && (
                      <span className="text-xs text-zinc-400"> · ★{Number(b.user.rating_avg).toFixed(1)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-zinc-500">{daysUntil(b.expires_at)}d</td>
                  <td className="px-3 py-2 text-right">
                    {canFastAccept ? (
                      <button
                        onClick={() => setAccepting(b)}
                        className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors cursor-pointer"
                      >
                        Accept
                      </button>
                    ) : (
                      <Link
                        href={`/sell?card=${encodeURIComponent(b.card_id)}`}
                        className="px-3 py-1.5 rounded-md ring-1 ring-zinc-200 text-zinc-600 hover:bg-zinc-50 text-xs font-semibold transition-colors"
                        title="This older offer is fulfilled through the sell flow"
                      >
                        Sell into offer →
                      </Link>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {accepting && (
        <AcceptOfferModal
          open={!!accepting}
          onClose={() => setAccepting(null)}
          bidId={accepting.id}
          price={Number(accepting.price)}
          variantLabel={variantLabel(accepting)}
          cardName={cardNames[accepting.card_id] || accepting.card_id}
        />
      )}
    </>
  )
}
