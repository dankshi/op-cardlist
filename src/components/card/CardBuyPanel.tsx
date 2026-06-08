'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { BuyNowButton } from '@/components/marketplace/BuyNowButton'
import { buildChips, type ChipData, type VariantData } from './variantChips'

export type { VariantData } from './variantChips'

export function CardBuyPanel({
  cardId,
  variants,
  selectedKey,
  showMarketLink = true,
  onViewMarketData,
  onOfferClick,
  onAcceptOfferClick,
  onListClick,
  onModeChange,
  topOfferPrice,
}: {
  cardId: string
  variants: VariantData[]
  /** Variant the buy box acts on. Owned by the parent (CardMainPanel),
   *  which lifts the selection up so the GradeSelector ladder and the
   *  market-data drawer all stay in sync with one source of truth. */
  selectedKey: string
  /** Whether to render the "View market data" link at all. The market
   *  drawer is admin-only while the marketplace seeds, so the parent
   *  suppresses the link for users who can't see the drawer. Defaults to
   *  true so standalone usage (e.g. /market) keeps the link. */
  showMarketLink?: boolean
  /** Called when the user clicks the "View market data" link, so the
   *  parent can scroll/expand its inline drawer instead of navigating. */
  onViewMarketData?: () => void
  /** Called when the user clicks the Offer button. Parent opens a
   *  modal with the offer-placement form prefilled to the current
   *  variant. When omitted, the Offer button falls back to navigating
   *  to /card/[id]/market#bids. */
  onOfferClick?: () => void
  /** Called when the user clicks "Accept" on the top-offer pill.
   *  Parent opens an AcceptOfferModal with the offer terms + payout. */
  onAcceptOfferClick?: () => void
  /** Called when the user clicks "List for more" / "List your card".
   *  Parent opens a price-input modal that POSTs to /api/listings
   *  inline instead of redirecting to the multi-step /sell flow. */
  onListClick?: () => void
  /** Notified when the user toggles between Buy and Sell mode so the
   *  parent can sync sibling UI (e.g. switching the market drawer to
   *  the Listings or Offers tab to match the active perspective). */
  onModeChange?: (mode: 'buy' | 'sell') => void
  /** Highest open offer price for the currently-selected variant.
   *  Surfaces an "Accept" CTA so sellers don't have to drill into the
   *  Offers tab to find the matching bid. */
  topOfferPrice?: number | null
}) {
  // Build the full chip ladder once. The buy box only renders the *selected*
  // chip; the grade ladder (GradeSelector) renders the rest. Both share
  // buildChips() so the selected key always resolves to the same variant.
  const allChips = useMemo<ChipData[]>(() => buildChips(variants), [variants])

  // Buy vs Sell perspective toggle (StockX pattern). Default to buy — most
  // users on a card page are shopping. They flip to sell via the contextual
  // footer link, which shows the top-offer price as a teaser.
  const [mode, setModeState] = useState<'buy' | 'sell'>('buy')
  function setMode(next: 'buy' | 'sell') {
    setModeState(next)
    onModeChange?.(next)
  }

  const selected = allChips.find(c => c.key === selectedKey) ?? allChips[0]

  return (
    /* Borderless action block — sits in the card-detail action column as a
       clean stack (the selected-grade chip lives just above this, the grade
       ladder full-width below). No card border so the page reads as one
       region rather than boxes-in-boxes. */
    <div>
      {/* Buy/Sell mode toggle. Buy mode (default) is buyer's perspective —
          big price is the lowest ask, primary action is Buy Now. Sell mode
          flips it — big price is the top offer, primary action is Sell Now
          (which accepts that offer). Each mode shows ONE perspective at a
          time so users aren't drowning in CTAs; the contextual link at the
          bottom shows the other side's price so the switch is one click. */}
      {mode === 'buy' ? (
        <>
          {selected.lowestListingPrice != null && selected.lowestListingId ? (
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  Buy now for
                </span>
              </div>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-4xl font-light tabular-nums tracking-tight text-zinc-900 leading-none">
                    ${selected.lowestListingPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* Single-quantity only for now — buyers purchase one card
                      at a time. (Multi-qty Buy Now is temporarily disabled.) */}
                  <OfferButton onClick={onOfferClick} cardId={cardId} />
                  <BuyNowButton listingId={selected.lowestListingId} price={selected.lowestListingPrice} quantity={1} size="lg" />
                </div>
              </div>
            </div>
          ) : (
            /* No listing for this variant — keep the SAME layout as the
               listed state (label row + big line + buttons on the right),
               only the headline + CTA wording change. */
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  Buy now for
                </span>
              </div>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-4xl font-light tracking-tight text-zinc-400 leading-none">
                    No listings yet
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <OfferButton onClick={onOfferClick} cardId={cardId} />
                  <ListButton onClick={onListClick} cardId={cardId} selected={selected} variant="primary">
                    List yours
                  </ListButton>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {topOfferPrice != null && topOfferPrice > 0 ? (
            <div className="mb-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">Sell now for</p>
              <div className="flex items-end justify-between gap-3">
                <p className="text-4xl font-light tabular-nums tracking-tight text-emerald-700 leading-none">
                  ${topOfferPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <ListButton onClick={onListClick} cardId={cardId} selected={selected} variant="outline">
                    List for more
                  </ListButton>
                  <button
                    type="button"
                    onClick={onAcceptOfferClick}
                    className="px-5 py-3 rounded-lg text-base font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors cursor-pointer"
                  >
                    Sell Now
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* No offers — keep the SAME layout as the offered/buy states
               (label row + big line + button on the right) so toggling
               buy↔sell doesn't shift the panel. */
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  Sell now for
                </span>
              </div>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-4xl font-light tracking-tight text-zinc-400 leading-none">
                    No offers yet
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <ListButton onClick={onListClick} cardId={cardId} selected={selected} variant="primary">
                    List your card
                  </ListButton>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <div className="flex items-center justify-between gap-3 pt-3 border-t border-zinc-100 text-xs">
        {/* Mode toggle. Wording mirrors StockX: shows the other side's
            price as the call to action so the user knows what they'd get
            if they flipped perspectives. */}
        {mode === 'buy' ? (
          <button
            type="button"
            onClick={() => setMode('sell')}
            className="text-emerald-700 hover:text-emerald-800 font-semibold inline-flex items-center gap-1 cursor-pointer"
          >
            {topOfferPrice != null && topOfferPrice > 0
              ? <>Sell yours now for <span className="tabular-nums tracking-tight">${topOfferPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> →</>
              : <>Sell yours →</>}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setMode('buy')}
            className="text-orange-600 hover:text-orange-700 font-semibold inline-flex items-center gap-1 cursor-pointer"
          >
            ← Buy now{selected.lowestListingPrice != null && <> for <span className="tabular-nums">${selected.lowestListingPrice.toFixed(2)}</span></>}
          </button>
        )}
        {showMarketLink && (onViewMarketData ? (
          <a
            href="#market"
            onClick={(e) => {
              e.preventDefault()
              onViewMarketData()
              if (typeof window !== 'undefined') {
                const el = document.getElementById('market')
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            }}
            className="text-zinc-500 hover:text-zinc-900 font-semibold cursor-pointer"
          >
            View market data
          </a>
        ) : (
          <Link
            href={`/card/${cardId.toLowerCase()}/market`}
            className="text-zinc-500 hover:text-zinc-900 font-semibold"
          >
            View market data
          </Link>
        ))}
      </div>
    </div>
  )
}

/** Offer CTA. Calls onClick when wired up (parent opens modal); falls
 *  back to a Link into the market-data view when used standalone (e.g.
 *  the /card/[id]/market page where the form lives in the Offers tab). */
function OfferButton({
  onClick,
  cardId,
  variant = 'inline',
}: {
  onClick?: () => void
  cardId: string
  variant?: 'inline' | 'block'
}) {
  const cls =
    variant === 'inline'
      ? 'px-5 py-3 rounded-lg text-base font-semibold bg-white text-zinc-900 ring-2 ring-zinc-300 hover:ring-zinc-900 hover:bg-zinc-50 transition-colors cursor-pointer'
      : 'text-center py-2.5 rounded-lg border-2 border-zinc-300 hover:border-zinc-900 text-sm font-semibold text-zinc-900 transition-colors cursor-pointer'
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls}>
        {variant === 'inline' ? 'Offer' : 'Make Offer'}
      </button>
    )
  }
  return (
    <Link href={`/card/${cardId.toLowerCase()}/market#bids`} className={cls}>
      {variant === 'inline' ? 'Offer' : 'Make Offer'}
    </Link>
  )
}

/** List CTA. Opens the inline ListModal when a click handler is wired
 *  (parent has the modal); falls back to a Link into the full /sell
 *  flow with the variant pre-filled when used standalone. */
function ListButton({
  onClick,
  cardId,
  selected,
  variant,
  children,
}: {
  onClick?: () => void
  cardId: string
  selected: ChipData
  variant: 'primary' | 'outline'
  children: React.ReactNode
}) {
  const cls =
    variant === 'primary'
      ? 'px-5 py-3 rounded-lg text-base font-semibold bg-orange-500 hover:bg-orange-600 text-white transition-colors cursor-pointer'
      : 'px-5 py-3 rounded-lg text-base font-semibold bg-white text-zinc-900 ring-2 ring-zinc-300 hover:ring-zinc-900 hover:bg-zinc-50 transition-colors cursor-pointer'
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls}>
        {children}
      </button>
    )
  }
  return (
    <Link
      href={
        `/sell?card=${encodeURIComponent(cardId)}`
        + (selected.companyKey ? `&grading_company=${selected.companyKey}` : '')
        + (selected.grade ? `&grade=${encodeURIComponent(selected.grade)}` : '')
      }
      className={cls}
    >
      {children}
    </Link>
  )
}
