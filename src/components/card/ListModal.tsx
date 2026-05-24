'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { gradingStyle } from '@/lib/gradingStyle'

interface Props {
  open: boolean
  onClose: () => void
  cardId: string
  cardName: string
  /** Variant from the chip selector — drives the listing's
   *  grading_company + grade and the in-modal label display. */
  company: string | null
  grade: string | null
  /** Reference points for the price-suggestion buttons. Top offer
   *  becomes the floor (you must list above it); market price is a
   *  fallback anchor for raw cards when there are no offers yet. */
  topOfferPrice: number | null
  marketPrice: number | null
  /** Listings the current user already has active on this exact variant.
   *  Shown as a warning at the top of the modal so they don't accidentally
   *  stack duplicates — each represents a distinct physical card, so
   *  adding another can be legitimate, but we want them to think about it. */
  existingOwnListings?: Array<{ id: string; price: number }>
}

/** Quick-list modal — minimum-friction path for a seller who already
 *  has the card and just needs to pick a price. Auto-generates the
 *  listing title, defaults condition to NM, skips photos (a follow-up
 *  edit can add them). For the full sell flow (multi-step form,
 *  photo upload, etc.) the "Sell yours" footer link still goes to /sell. */
export function ListModal({
  open,
  onClose,
  cardId,
  cardName,
  company,
  grade,
  topOfferPrice,
  marketPrice,
  existingOwnListings,
}: Props) {
  const router = useRouter()
  const [price, setPrice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Pre-fill with a sensible default: ~10% above top offer, falling
  // back to market price + 5%, falling back to blank.
  useEffect(() => {
    if (!open) return
    setError(null)
    if (topOfferPrice != null && topOfferPrice > 0) {
      setPrice((topOfferPrice * 1.1).toFixed(2))
    } else if (marketPrice != null && marketPrice > 0) {
      setPrice((marketPrice * 1.05).toFixed(2))
    } else {
      setPrice('')
    }
  }, [open, topOfferPrice, marketPrice])

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

  const variantLabel = company && grade ? `${company} ${grade}` : 'Ungraded NM'
  const style = company && grade ? gradingStyle(company, grade) : null

  // Suggestion anchor: top offer if present, else market. Percentage
  // bumps scale to value tier without needing tiered logic per card.
  const anchor = topOfferPrice ?? marketPrice ?? null

  // Floor: a listing at or below the top offer is rejected by the
  // marketplace (the offer should be filled instead). Surface this
  // inline before the user clicks Submit.
  const priceNum = parseFloat(price)
  const validPrice = Number.isFinite(priceNum) && priceNum > 0
  const belowFloor = topOfferPrice != null && validPrice && priceNum <= topOfferPrice

  function bumpByPct(pct: number) {
    if (anchor == null) return
    setPrice((anchor * (1 + pct)).toFixed(2))
  }

  async function handleSubmit() {
    if (!validPrice) {
      setError('Enter a valid price.')
      return
    }
    if (belowFloor) {
      setError(`Price must be above the top offer ($${topOfferPrice!.toFixed(2)}).`)
      return
    }
    setSubmitting(true)
    setError(null)
    const title = `${cardName}${company && grade ? ` (${company} ${grade})` : ' (NM)'}`
    const res = await fetch('/api/listings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        card_id: cardId,
        title,
        price: priceNum,
        condition: 'near_mint',
        quantity: 1,
        language: 'EN',
        is_first_edition: false,
        photo_urls: [],
        grading_company: company,
        grade,
      }),
    })
    setSubmitting(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error || 'Failed to list. You may need to complete seller setup.')
      return
    }
    onClose()
    // Soft-refresh so the new listing appears in the chip row + Listings
    // tab. Could swap for router.refresh() once we move to React state-
    // sync, but reload is the bullet-proof shortcut today.
    if (typeof window !== 'undefined') window.location.reload()
  }

  if (!open) return null

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
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-zinc-900">List your card</h2>
            <div className="flex items-center gap-2 mt-1">
              {style ? (
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ring-1 ${style.pill}`}>
                  {style.shortLabel}
                </span>
              ) : (
                <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-zinc-200 text-zinc-700 ring-1 ring-zinc-300">
                  Ungraded NM
                </span>
              )}
              <span className="text-sm text-zinc-500 truncate">{cardName}</span>
            </div>
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
          {/* Existing-listings warning. We don't block adding another
              (different physical card could be the same variant) but we
              surface what's already there with manage-it shortcuts so
              the user is making an informed choice. */}
          {existingOwnListings && existingOwnListings.length > 0 && (
            <div className="rounded-lg bg-amber-50 ring-1 ring-amber-200 p-3 text-sm">
              <p className="text-amber-900 mb-2">
                You already have {existingOwnListings.length === 1 ? '' : `${existingOwnListings.length} `}
                active listing{existingOwnListings.length === 1 ? '' : 's'} for this variant:
              </p>
              <div className="space-y-1.5">
                {existingOwnListings.map(l => (
                  <div key={l.id} className="flex items-center justify-between gap-2">
                    <span className="font-bold tabular-nums text-amber-900">${l.price.toFixed(2)}</span>
                    <Link
                      href={`/sell/${l.id}/edit`}
                      className="text-[11px] font-semibold text-amber-800 hover:text-amber-900 underline-offset-2 hover:underline"
                    >
                      Manage →
                    </Link>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-amber-700 mt-2 leading-snug">
                Adding another below is fine if you have a second physical copy. Otherwise edit the existing one.
              </p>
            </div>
          )}

          {/* Reference prices. Showing both gives the seller context for
              what's reasonable without making them switch tabs. */}
          {(topOfferPrice != null || marketPrice != null) && (
            <div className="grid grid-cols-2 gap-3 text-xs">
              {topOfferPrice != null && (
                <div className="rounded-lg bg-emerald-50 ring-1 ring-emerald-100 p-3">
                  <p className="font-bold uppercase tracking-wider text-emerald-700 mb-0.5">Top offer</p>
                  <p className="text-base font-bold tabular-nums text-emerald-900">${topOfferPrice.toFixed(2)}</p>
                </div>
              )}
              {marketPrice != null && (
                <div className="rounded-lg bg-zinc-50 ring-1 ring-zinc-100 p-3">
                  <p className="font-bold uppercase tracking-wider text-zinc-500 mb-0.5">Market</p>
                  <p className="text-base font-bold tabular-nums text-zinc-900">${marketPrice.toFixed(2)}</p>
                </div>
              )}
            </div>
          )}

          {/* Price input + percentage-bump chips. Percentages scale the
              anchor (top offer > market > nothing), so the same chips
              are useful on a $5 raw card and a $25k slab. */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">
              Your asking price
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
                placeholder="0.00"
                className="w-full pl-8 pr-3 py-3 rounded-lg border-2 border-zinc-200 focus:border-orange-500 focus:outline-none text-2xl font-bold tabular-nums text-zinc-900 disabled:opacity-50"
              />
            </div>
            {anchor != null && (
              <div className="flex items-center gap-1.5 mt-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Quick set:</span>
                <button type="button" disabled={submitting} onClick={() => bumpByPct(0.05)} className="px-2 py-1 rounded text-[11px] font-semibold text-orange-700 ring-1 ring-orange-200 bg-white hover:bg-orange-50 transition-colors cursor-pointer disabled:opacity-50">+5%</button>
                <button type="button" disabled={submitting} onClick={() => bumpByPct(0.1)} className="px-2 py-1 rounded text-[11px] font-semibold text-orange-700 ring-1 ring-orange-200 bg-white hover:bg-orange-50 transition-colors cursor-pointer disabled:opacity-50">+10%</button>
                <button type="button" disabled={submitting} onClick={() => bumpByPct(0.25)} className="px-2 py-1 rounded text-[11px] font-semibold text-orange-700 ring-1 ring-orange-200 bg-white hover:bg-orange-50 transition-colors cursor-pointer disabled:opacity-50">+25%</button>
              </div>
            )}
          </div>

          <p className="text-[11px] text-zinc-400 leading-snug">
            Photos and full listing details can be added from your
            seller dashboard after you list. The card stays inactive
            for buyers until you ship it to Nomi for verification.
          </p>

          {belowFloor && (
            <div className="rounded-lg bg-amber-50 ring-1 ring-amber-200 p-3 text-sm text-amber-800">
              List price must be above the top offer (${topOfferPrice!.toFixed(2)}).
              At or below that, the offer should be accepted instead.
            </div>
          )}
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
            onClick={handleSubmit}
            disabled={submitting || !validPrice || belowFloor}
            className="px-5 py-2.5 rounded-lg text-sm font-bold bg-orange-500 hover:bg-orange-600 text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Listing…' : validPrice ? `List for $${priceNum.toFixed(2)}` : 'List'}
          </button>
        </div>
      </div>
    </div>
  )
}
