'use client'

import { useEffect, useMemo, useState } from 'react'
import { CardBuyPanel, type VariantData } from './CardBuyPanel'
import { MarketTabs } from './MarketTabs'
import { OfferModal } from './OfferModal'
import { AcceptOfferModal } from './AcceptOfferModal'
import type { CardCondition } from '@/types/database'

interface AskInput {
  id: string
  price: number
  condition: CardCondition
  grading_company: string | null
  grade: string | null
  quantity_available: number
  created_at: string
  sellerName: string
}

interface BidInput {
  id: string
  price: number
  grading_company: string | null
  grade: string | null
  created_at: string
  buyerName: string
  /** user_id of the bid creator — used to mark "Your offer" rows in the
   *  Offers tab. Server-passed so we don't need an extra client-side
   *  auth round-trip just to colour a few rows. */
  userId: string
}

interface SaleInput {
  date: string
  price: number
  label: string
  source: string
  company: string | null
  grade: string | null
}

/** Wraps the buy panel + an inline collapsible market-data drawer so they
 *  share one `selectedVariant` state. Clicking a chip in the buy panel
 *  filters the asks/bids/sales tables below to that variant — no
 *  navigation, no second source of truth. */
export function CardMainPanel({
  cardId,
  cardName,
  variants,
  marketPrice,
  priceChangePercent,
  asks,
  bids,
  sales,
  currentUserId,
}: {
  cardId: string
  cardName: string
  variants: VariantData[]
  marketPrice: number | null
  priceChangePercent: number | null
  asks: AskInput[]
  bids: BidInput[]
  sales: SaleInput[]
  /** ID of the currently-logged-in user (null if signed out). Used to
   *  tag the buyer's own offers in the Offers tab. */
  currentUserId: string | null
}) {
  // Initial selection mirrors what CardBuyPanel would have picked: the
  // cheapest variant with a listing, fall back to Raw. We compute it here
  // so the inline drawer's filter starts in sync.
  const initialKey = useMemo(() => {
    const withListings = variants.filter(v => v.lowestListingPrice != null)
    if (withListings.length === 0) return 'raw'
    return withListings.sort(
      (a, b) => (a.lowestListingPrice ?? 0) - (b.lowestListingPrice ?? 0),
    )[0].key
  }, [variants])

  const [selectedKey, setSelectedKey] = useState(initialKey)
  const [open, setOpen] = useState(false)
  const [offerOpen, setOfferOpen] = useState(false)
  const [acceptOpen, setAcceptOpen] = useState(false)

  // Auto-open the drawer when the URL hash targets the market section so
  // the "View market data" / "Offer" links scroll the user straight in.
  useEffect(() => {
    function check() {
      const hash = window.location.hash.replace('#', '')
      if (['market', 'asks', 'bids', 'sales'].includes(hash)) setOpen(true)
    }
    check()
    window.addEventListener('hashchange', check)
    return () => window.removeEventListener('hashchange', check)
  }, [])

  // Parse variant key into (company, grade). `selectedKey` is either
  // 'raw' or '<company>-<grade>' (e.g. 'PSA-10', 'BGS-Black Label 10').
  const filter = useMemo(() => parseFilter(selectedKey), [selectedKey])
  const isRaw = selectedKey === 'raw'

  const filteredAsks = useMemo(
    () => asks.filter(a => matchVariant(a.grading_company, a.grade, filter)),
    [asks, filter],
  )
  // Lowest ask for the selected variant. We hide any offers priced at or
  // above this — they're nonsensical (a buyer should just buy the
  // listing rather than offer the same/more). Surfacing them muddies
  // the bid stack and tempts mis-clicks.
  const lowestAsk = useMemo(
    () => (filteredAsks.length === 0 ? null : Math.min(...filteredAsks.map(a => a.price))),
    [filteredAsks],
  )
  const filteredBids = useMemo(
    () => bids
      .filter(b => matchVariant(b.grading_company, b.grade, filter))
      .filter(b => lowestAsk == null || b.price < lowestAsk),
    [bids, filter, lowestAsk],
  )
  const filteredSales = useMemo(
    () => sales.filter(s => matchVariant(s.company, s.grade, filter)),
    [sales, filter],
  )

  // Highest open offer for the currently-selected variant. Drives the
  // "Accept offer $X" CTA on the buy panel so a seller doesn't have to
  // dig into the Offers tab to find the matching bid. Track the bid id
  // too so the Accept modal can call /api/bids/[id]/accept directly.
  const topOffer = useMemo<{ id: string; price: number } | null>(() => {
    if (filteredBids.length === 0) return null
    let best = filteredBids[0]
    for (const b of filteredBids) {
      if (b.price > best.price) best = b
    }
    return { id: best.id, price: best.price }
  }, [filteredBids])

  const filterLabel = isRaw
    ? 'Ungraded NM'
    : filter
      ? `${filter.company} ${filter.grade}`
      : 'All variants'

  return (
    <div>
      <CardBuyPanel
        cardId={cardId}
        variants={variants}
        marketPrice={marketPrice}
        priceChangePercent={priceChangePercent}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
        onViewMarketData={() => setOpen(true)}
        onOfferClick={() => setOfferOpen(true)}
        onAcceptOfferClick={() => setAcceptOpen(true)}
        topOfferPrice={topOffer?.price ?? null}
      />

      <OfferModal
        open={offerOpen}
        onClose={() => setOfferOpen(false)}
        cardId={cardId}
        cardName={cardName}
        initialCompany={filter?.company ?? null}
        initialGrade={filter?.grade ?? null}
      />

      {topOffer && (
        <AcceptOfferModal
          open={acceptOpen}
          onClose={() => setAcceptOpen(false)}
          bidId={topOffer.id}
          price={topOffer.price}
          variantLabel={filterLabel}
          cardName={cardName}
        />
      )}

      <div id="market" className="mt-4">
        <button
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center justify-between gap-2 px-4 py-3 rounded-xl border-2 border-zinc-200 bg-white hover:border-zinc-400 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-zinc-900">Market data</span>
            <span className="text-xs text-zinc-500">
              Filtered to <span className="font-semibold text-zinc-700">{filterLabel}</span>
              {' · '}
              <span className="tabular-nums">{filteredAsks.length} listings · {filteredBids.length} offers · {filteredSales.length} sales</span>
            </span>
          </div>
          <svg
            className={`w-4 h-4 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {open && (
          <div className="mt-3">
            <MarketTabs
              asks={filteredAsks}
              bids={filteredBids.map(b => ({
                id: b.id,
                price: b.price,
                grading_company: b.grading_company,
                grade: b.grade,
                created_at: b.created_at,
                buyerName: b.buyerName,
                isYou: currentUserId != null && b.userId === currentUserId,
              }))}
              sales={filteredSales.map(s => ({ date: s.date, price: s.price, label: s.label, source: s.source }))}
              cardId={cardId}
              bidsVariantFilter={{ company: filter?.company ?? null, grade: filter?.grade ?? null }}
              onCancelOffer={async (bidId: string) => {
                const res = await fetch(`/api/bids?id=${bidId}`, { method: 'DELETE' })
                if (!res.ok) {
                  alert('Failed to cancel offer.')
                  return
                }
                // Soft-refresh: a full page reload is the simplest way to
                // re-fetch server data without a client-side store. The
                // buy panel + market drawer both update from server props.
                if (typeof window !== 'undefined') window.location.reload()
              }}
              onUpdateOffer={async (bidId, newPrice) => {
                const res = await fetch(`/api/bids/${bidId}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ price: newPrice }),
                })
                if (!res.ok) {
                  const body = await res.json().catch(() => ({}))
                  alert(body.error || 'Failed to update offer.')
                  return
                }
                if (typeof window !== 'undefined') window.location.reload()
              }}
              lowestAskPrice={lowestAsk}
              topOfferPrice={topOffer?.price ?? null}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function parseFilter(key: string): { company: string; grade: string } | null {
  if (key === 'raw') return null
  const dash = key.indexOf('-')
  if (dash < 0) return null
  return { company: key.slice(0, dash), grade: key.slice(dash + 1) }
}

/** True when a row's (company, grade) matches the active variant filter.
 *  Filter = null means "raw only" (no grading), otherwise exact match. */
function matchVariant(
  rowCompany: string | null | undefined,
  rowGrade: string | null | undefined,
  filter: { company: string; grade: string } | null,
): boolean {
  if (!filter) return !rowCompany && !rowGrade
  return rowCompany === filter.company && rowGrade === filter.grade
}
