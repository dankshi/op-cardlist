'use client'

import { useEffect, useState } from 'react'
import { BidAskSpread } from '@/components/marketplace/BidAskSpread'
import type { GradingCompany } from '@/types/database'

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
}

/** Focused offer-placement modal. Wraps BidAskSpread with its form
 *  auto-opened and prefilled, plus a backdrop + escape-to-close + body-
 *  scroll lock. Lives on the card page so users don't have to navigate
 *  to the market data view just to make an offer. */
export function OfferModal({ open, onClose, cardId, cardName, initialCompany, initialGrade, existingOffer }: Props) {
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
              {existingOffer ? 'Update your offer' : 'Make an offer'}
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

        {existingOffer ? (
          <UpdateOfferForm
            existingOffer={existingOffer}
            onClose={onClose}
          />
        ) : (
          <div className="px-6 py-4">
            <BidAskSpread
              cardId={cardId}
              initialFormOpen
              initialOfferType={initialOfferType}
              initialGradingCompany={initialGradingCompany}
              initialGrade={initialGrade ?? undefined}
              hideExistingBids
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
