'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  open: boolean
  onClose: () => void
  bidId: string
  price: number
  variantLabel: string
  cardName: string
}

/** Confirmation modal for accepting a buyer's offer. Shows the price,
 *  approximate payout, what happens next (shipping to Nomi), and
 *  finalizes via POST /api/bids/[bidId]/accept which captures the
 *  buyer's pre-auth payment and creates the order. */
export function AcceptOfferModal({ open, onClose, bidId, price, variantLabel, cardName }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose, submitting])

  if (!open) return null

  // Conservative payout estimate. Final cut depends on the seller's tier
  // (7-9.5% marketplace fee). Display the floor so the seller isn't
  // surprised on the downside; the call-out tells them their actual tier
  // may yield more.
  const marketplaceFloor = 0.075
  const stripeFee = 0.029 * price + 0.30
  const approxPayout = price - price * marketplaceFloor - stripeFee

  async function handleAccept() {
    setSubmitting(true)
    setError(null)
    const res = await fetch(`/api/bids/${bidId}/accept`, { method: 'POST' })
    setSubmitting(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error || 'Failed to accept offer.')
      return
    }
    const data = await res.json().catch(() => ({}))
    onClose()
    if (data.orderId) router.push(`/orders/${data.orderId}`)
    else router.refresh()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-4 py-8"
      onClick={() => { if (!submitting) onClose() }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-3 border-b border-zinc-100">
          <div>
            <h2 className="text-lg font-bold text-zinc-900">Accept offer</h2>
            <p className="text-sm text-zinc-500 mt-0.5 truncate">{cardName} · {variantLabel}</p>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            className="flex-shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-full text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors cursor-pointer disabled:opacity-50"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Money block. Offer price → estimated payout. Single source of
              truth for what the seller will get; expanded fee math lives
              one level deeper in /mystuff > Settings. */}
          <div className="rounded-xl bg-zinc-50 p-4">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">Offer</span>
              <span className="text-2xl font-bold tabular-nums text-zinc-900">${price.toFixed(2)}</span>
            </div>
            <div className="flex items-baseline justify-between pt-2 border-t border-zinc-200">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">Your payout (est.)</span>
              <span className="text-xl font-bold tabular-nums text-emerald-700">${approxPayout.toFixed(2)}</span>
            </div>
            <p className="text-[11px] text-zinc-400 mt-1 leading-snug">
              Net of Nomi marketplace fee (7–9.5% by seller tier) + Stripe processing.
              Exact payout shown on the order page after acceptance.
            </p>
          </div>

          {/* Contractual / shipping commitment. Spelled out so a seller
              clicking Accept knows what they're agreeing to. */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">By accepting, you commit to:</h3>
            <ul className="space-y-2 text-sm text-zinc-700">
              <li className="flex items-start gap-2">
                <span className="text-emerald-600 font-bold mt-0.5">✓</span>
                <span>
                  Shipping the <strong>{variantLabel}</strong> card to Nomi within{' '}
                  <strong>5 business days</strong>. We&apos;ll email a prepaid label after you accept.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-600 font-bold mt-0.5">✓</span>
                <span>
                  The card matching this variant exactly. We verify on arrival; mismatches are returned at your cost.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-600 font-bold mt-0.5">✓</span>
                <span>
                  Payout to your wallet within <strong>24 hours</strong> of Nomi confirming receipt + authenticity.
                </span>
              </li>
            </ul>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 ring-1 ring-red-200 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-zinc-100 bg-zinc-50/50 rounded-b-2xl">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-zinc-700 hover:bg-zinc-100 transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleAccept}
            disabled={submitting}
            className="px-5 py-2.5 rounded-lg text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait"
          >
            {submitting ? 'Accepting…' : `Accept for $${price.toFixed(2)}`}
          </button>
        </div>
      </div>
    </div>
  )
}
