'use client'

import { useEffect } from 'react'
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
}

/** Focused offer-placement modal. Wraps BidAskSpread with its form
 *  auto-opened and prefilled, plus a backdrop + escape-to-close + body-
 *  scroll lock. Lives on the card page so users don't have to navigate
 *  to the market data view just to make an offer. */
export function OfferModal({ open, onClose, cardId, cardName, initialCompany, initialGrade }: Props) {
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
            <h2 className="text-lg font-bold text-zinc-900">Make an offer</h2>
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
      </div>
    </div>
  )
}
