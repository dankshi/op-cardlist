'use client'

import { useEffect, useState } from 'react'
import { BidAskSpread } from '@/components/marketplace/BidAskSpread'
import type { Bid, GradingCompany } from '@/types/database'
import { gradingStyle } from '@/lib/gradingStyle'

interface Props {
  open: boolean
  onClose: () => void
  cardId: string
  cardName: string
  /** Variant the user had selected in the card-page chip row — drives the
   *  form's initial Raw/Graded toggle + company + grade so they don't
   *  have to re-pick what they just clicked. They can change it inside. */
  initialCompany: string | null
  initialGrade: string | null
  /** When the user already has an active offer on this exact variant,
   *  the modal flips into "Update your offer" mode — a simple price
   *  input that PATCHes the existing bid instead of stacking a second
   *  offer on top. */
  existingOffer?: { id: string; price: number } | null
  /** Notified when an offer is successfully placed — lets the parent
   *  push the new bid into shared state so the market drawer reflects
   *  it without a page reload. */
  onPlaced?: (bid: Bid) => void
  /** Reference prices shown above the offer form so the buyer doesn't
   *  have to close the modal to check what others are paying / asking.
   *  All optional — each is rendered only when set. */
  lowestAskPrice?: number | null
  topOfferPrice?: number | null
  marketPrice?: number | null
}

/** Focused offer-placement modal. Wraps BidAskSpread with its form
 *  auto-opened and prefilled, plus a backdrop + escape-to-close + body-
 *  scroll lock. Lives on the card page so users don't have to navigate
 *  to the market data view just to make an offer. */
export function OfferModal({
  open,
  onClose,
  cardId,
  cardName,
  initialCompany,
  initialGrade,
  existingOffer,
  onPlaced,
  lowestAskPrice,
  topOfferPrice,
  marketPrice,
}: Props) {
  // After-placement success state. Holds the just-placed bid so we can
  // confirm the price + variant on the success view. Cleared each time
  // the modal opens so a previous success doesn't bleed into a new
  // session.
  const [placedBid, setPlacedBid] = useState<Bid | null>(null)
  useEffect(() => { if (open) setPlacedBid(null) }, [open])
  // Esc closes; lock body scroll while open so the page behind doesn't
  // scroll under the modal.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  const initialOfferType: 'raw' | 'graded' = initialCompany ? 'graded' : 'raw'
  const initialGradingCompany: GradingCompany | undefined =
    initialCompany && ['PSA', 'BGS', 'CGC', 'TAG'].includes(initialCompany)
      ? (initialCompany as GradingCompany)
      : undefined

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-4 py-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Make an offer on ${cardName}`}
    >
      <div
        className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-3 border-b border-zinc-100">
          <div>
            <h2 className="text-lg font-bold text-zinc-900">
              {placedBid ? 'Offer placed' : existingOffer ? 'Update your offer' : 'Make an offer'}
            </h2>
            <p className="text-sm text-zinc-500 mt-0.5 truncate">{cardName}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex-shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-full text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors cursor-pointer"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {placedBid ? (
          <OfferPlacedSuccess
            bid={placedBid}
            cardName={cardName}
            onClose={onClose}
            onPlaceAnother={() => setPlacedBid(null)}
          />
        ) : existingOffer ? (
          <UpdateOfferForm
            existingOffer={existingOffer}
            onClose={onClose}
          />
        ) : (
          <div className="px-6 py-4 space-y-4">
            {/* Reference panel — three small cards so the buyer can
                anchor their offer without bouncing back to the market
                drawer. Lowest ask is the upper bound (above it = buy
                instead); top offer is what they need to beat to lead. */}
            {(lowestAskPrice != null || topOfferPrice != null || marketPrice != null) && (
              <div className="grid grid-cols-3 gap-2 text-xs">
                {topOfferPrice != null ? (
                  <div className="rounded-lg bg-emerald-50 ring-1 ring-emerald-100 p-2.5">
                    <p className="font-bold uppercase tracking-wider text-emerald-700 mb-0.5 text-[10px]">Top offer</p>
                    <p className="text-base font-bold tabular-nums text-emerald-900">${topOfferPrice.toFixed(2)}</p>
                  </div>
                ) : <ReferencePlaceholder label="Top offer" />}
                {lowestAskPrice != null ? (
                  <div className="rounded-lg bg-orange-50 ring-1 ring-orange-100 p-2.5">
                    <p className="font-bold uppercase tracking-wider text-orange-700 mb-0.5 text-[10px]">Lowest ask</p>
                    <p className="text-base font-bold tabular-nums text-orange-900">${lowestAskPrice.toFixed(2)}</p>
                  </div>
                ) : <ReferencePlaceholder label="Lowest ask" />}
                {marketPrice != null ? (
                  <div className="rounded-lg bg-zinc-50 ring-1 ring-zinc-100 p-2.5">
                    <p className="font-bold uppercase tracking-wider text-zinc-500 mb-0.5 text-[10px]">Market</p>
                    <p className="text-base font-bold tabular-nums text-zinc-900">${marketPrice.toFixed(2)}</p>
                  </div>
                ) : <ReferencePlaceholder label="Market" />}
              </div>
            )}
            <BidAskSpread
              cardId={cardId}
              initialFormOpen
              initialOfferType={initialOfferType}
              initialGradingCompany={initialGradingCompany}
              initialGrade={initialGrade ?? undefined}
              hideExistingBids
              onPlaced={(bid) => {
                setPlacedBid(bid)
                onPlaced?.(bid)
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

/** Lightweight in-modal price editor for the user's already-existing
 *  offer. Avoids the full BidAskSpread (no Stripe Elements, no variant
 *  picker) — they're keeping the same variant, just changing price.
 *  PATCH on /api/bids/[id] only works for non-PI bids today; PI-backed
 *  bids surface the server's "cancel and place a new one" message. */
function UpdateOfferForm({
  existingOffer,
  onClose,
}: {
  existingOffer: { id: string; price: number }
  onClose: () => void
}) {
  const [price, setPrice] = useState(existingOffer.price.toFixed(2))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    const num = parseFloat(price)
    if (!Number.isFinite(num) || num <= 0) {
      setError('Enter a valid price.')
      return
    }
    if (num === existingOffer.price) {
      onClose()
      return
    }
    setSubmitting(true)
    setError(null)
    const res = await fetch(`/api/bids/${existingOffer.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: num }),
    })
    setSubmitting(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error || 'Failed to update offer.')
      return
    }
    onClose()
    if (typeof window !== 'undefined') window.location.reload()
  }

  async function handleCancel() {
    if (!confirm('Cancel this offer? Your card-on-file authorization will be released.')) return
    setSubmitting(true)
    setError(null)
    const res = await fetch(`/api/bids?id=${existingOffer.id}`, { method: 'DELETE' })
    setSubmitting(false)
    if (!res.ok) {
      setError('Failed to cancel offer.')
      return
    }
    onClose()
    if (typeof window !== 'undefined') window.location.reload()
  }

  return (
    <div>
      <div className="px-6 py-5 space-y-4">
        <div className="rounded-lg bg-orange-50 ring-1 ring-orange-200 p-3 text-sm">
          <p className="text-orange-900">
            You already have an offer for{' '}
            <span className="font-bold tabular-nums">${existingOffer.price.toFixed(2)}</span>{' '}
            on this variant. Adjust the price below or cancel.
          </p>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">
            New offer price
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-2xl font-bold text-zinc-400">$</span>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={price}
              onChange={(e) => { setPrice(e.target.value); setError(null) }}
              disabled={submitting}
              className="w-full pl-8 pr-3 py-3 rounded-lg border-2 border-zinc-200 focus:border-orange-500 focus:outline-none text-2xl font-bold tabular-nums text-zinc-900 disabled:opacity-50"
            />
          </div>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 ring-1 ring-red-200 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-zinc-100 bg-zinc-50/50 rounded-b-2xl">
        <button
          type="button"
          onClick={handleCancel}
          disabled={submitting}
          className="px-4 py-2 rounded-lg text-sm font-semibold text-rose-700 hover:bg-rose-50 transition-colors cursor-pointer disabled:opacity-50"
        >
          Cancel offer
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-zinc-700 hover:bg-zinc-100 transition-colors cursor-pointer disabled:opacity-50"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="px-5 py-2.5 rounded-lg text-sm font-bold bg-orange-500 hover:bg-orange-600 text-white transition-colors cursor-pointer disabled:opacity-50"
          >
            {submitting ? 'Updating…' : 'Update offer'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Empty-state slot in the reference grid — keeps the three columns
 *  the same width whether or not all data points are populated. */
function ReferencePlaceholder({ label }: { label: string }) {
  return (
    <div className="rounded-lg bg-zinc-50 ring-1 ring-zinc-100 p-2.5 opacity-60">
      <p className="font-bold uppercase tracking-wider text-zinc-400 mb-0.5 text-[10px]">{label}</p>
      <p className="text-base font-bold text-zinc-300">—</p>
    </div>
  )
}

/** Post-placement confirmation. Cleaner than dropping the user into an
 *  empty modal body (which is what they used to see — BidAskSpread reset
 *  to its initial state and `hideExistingBids` hid the freshly-placed
 *  bid, leaving a blank shell). Now they get a confirmation + clear
 *  next actions: place another or close. */
function OfferPlacedSuccess({
  bid,
  cardName,
  onClose,
  onPlaceAnother,
}: {
  bid: Bid
  cardName: string
  onClose: () => void
  onPlaceAnother: () => void
}) {
  const style = bid.grading_company && bid.grade ? gradingStyle(bid.grading_company, bid.grade) : null
  return (
    <div>
      <div className="px-6 py-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold text-zinc-900 mb-0.5">Your offer is live.</p>
            <p className="text-sm text-zinc-500 truncate">{cardName}</p>
          </div>
        </div>

        <div className="rounded-xl bg-zinc-50 ring-1 ring-zinc-100 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">Offer</p>
              <p className="text-3xl font-bold tabular-nums text-zinc-900">${Number(bid.price).toFixed(2)}</p>
            </div>
            {style ? (
              <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ring-1 ${style.pill}`}>
                {style.shortLabel}
              </span>
            ) : (
              <span className="inline-block px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider bg-zinc-200 text-zinc-700 ring-1 ring-zinc-300">
                Ungraded NM
              </span>
            )}
          </div>
        </div>

        <ul className="text-xs text-zinc-500 space-y-1.5 leading-relaxed">
          <li className="flex gap-2">
            <span className="text-emerald-500 font-bold flex-shrink-0">✓</span>
            <span>Your card is held in pre-authorization. Nothing is charged until a seller accepts.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-emerald-500 font-bold flex-shrink-0">✓</span>
            <span>You can edit or cancel from the <strong className="text-zinc-700">Offers</strong> tab below.</span>
          </li>
        </ul>
      </div>

      <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-zinc-100 bg-zinc-50/50 rounded-b-2xl">
        <button
          type="button"
          onClick={onPlaceAnother}
          className="px-4 py-2 rounded-lg text-sm font-semibold text-zinc-700 hover:bg-zinc-100 transition-colors cursor-pointer"
        >
          Place another
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-5 py-2.5 rounded-lg text-sm font-bold bg-zinc-900 hover:bg-zinc-800 text-white transition-colors cursor-pointer"
        >
          Done
        </button>
      </div>
    </div>
  )
}

