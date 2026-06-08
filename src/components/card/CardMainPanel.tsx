'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { CardBuyPanel, type VariantData } from './CardBuyPanel'
import { GradeSelector } from './GradeSelector'
import { TrustBadges } from './TrustBadges'
import { MarketTabs } from './MarketTabs'
import { OfferModal } from './OfferModal'
import { AcceptOfferModal } from './AcceptOfferModal'
import { ListModal } from './ListModal'
import { createClient } from '@/lib/supabase/client'
import { useAdminMarketData } from '@/lib/useAdminMarketData'
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
  /** Seller's user_id — used to flag "this is YOUR listing" warnings
   *  in the ListModal so the user doesn't accidentally stack duplicate
   *  listings of the same variant. */
  sellerId: string
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
  asks,
  bids,
  sales,
  currentUserId,
  isAdmin,
  image,
  debug,
}: {
  cardId: string
  cardName: string
  variants: VariantData[]
  marketPrice: number | null
  asks: AskInput[]
  bids: BidInput[]
  sales: SaleInput[]
  /** ID of the currently-logged-in user (null if signed out). Used to
   *  tag the buyer's own offers in the Offers tab. */
  currentUserId: string | null
  /** Whether the viewer is an admin. The market-data drawer (and its
   *  "View market data" link) is admin-only for now — the marketplace is
   *  still seeding, so an empty Listings/Offers/Sales section would read
   *  as broken to a regular user. Admins can hide it via the profile
   *  dropdown toggle; non-admins never receive it at all. */
  isAdmin: boolean
  /** Server-rendered card image (Card3DPreview). Passed in so this client
   *  component can own the two-column layout while the image stays RSC. */
  image: ReactNode
  /** Optional admin debug block, rendered in the action column under the
   *  title. Server-gated upstream — non-admins never receive it. */
  debug?: ReactNode
}) {
  // Local mirror of server-passed bids + listings so inline mutations
  // (cancel / quick-action update / new placements) reflect in the UI
  // instantly without a page reload. Initialized once from props; we
  // don't re-sync on prop changes because props only change on a server-
  // driven navigation, at which point the local copy is correctly thrown
  // away with the component.
  const [bidsState, setBidsState] = useState<BidInput[]>(bids)
  const [asksState, setAsksState] = useState<AskInput[]>(asks)
  const supabase = useMemo(() => createClient(), [])
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
  // Admin gate + per-admin toggle for the market-data drawer. Non-admins
  // never see it; admins can hide it from the profile dropdown.
  const [marketDataVisible] = useAdminMarketData()
  const showMarket = isAdmin && marketDataVisible
  const [offerOpen, setOfferOpen] = useState(false)
  const [acceptOpen, setAcceptOpen] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  // Mirrors the buy/sell mode in CardBuyPanel so the inline market
  // drawer can default to (and follow) the matching tab — buy → Listings,
  // sell → Offers.
  const [mode, setMode] = useState<'buy' | 'sell'>('buy')

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
    () => asksState.filter(a => matchVariant(a.grading_company, a.grade, filter)),
    [asksState, filter],
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
    () => bidsState
      .filter(b => matchVariant(b.grading_company, b.grade, filter))
      .filter(b => lowestAsk == null || b.price < lowestAsk),
    [bidsState, filter, lowestAsk],
  )
  const filteredSales = useMemo(
    () => sales.filter(s => matchVariant(s.company, s.grade, filter)),
    [sales, filter],
  )

  // User's own existing state for the selected variant — drives the
  // "Update your offer" mode in OfferModal and the duplicate-listing
  // warning in ListModal. Computed off the already-filtered arrays so
  // these naturally update when the chip selection changes.
  const existingOwnOffer = useMemo(() => {
    if (currentUserId == null) return null
    return filteredBids.find(b => b.userId === currentUserId) ?? null
  }, [filteredBids, currentUserId])
  const existingOwnListings = useMemo(() => {
    if (currentUserId == null) return []
    return filteredAsks.filter(a => a.sellerId === currentUserId)
  }, [filteredAsks, currentUserId])

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
      {/* Two-column shopping region. Image left (server-rendered, passed
          in), borderless action column right. The grade ladder lives inside
          the action column, below the buy box, so the column reads as one
          clean, box-free stack. */}
      <div className="grid grid-cols-1 md:grid-cols-[380px_1fr] gap-10 mb-12">
        <div className="flex justify-center md:sticky md:top-24 md:self-start">
          {image}
        </div>

        <div>
          <h1 className="text-2xl font-bold text-zinc-900">{cardName}</h1>

          {debug && <div className="mt-3">{debug}</div>}

          <div className="mt-5">
            <CardBuyPanel
              cardId={cardId}
              variants={variants}
              selectedKey={selectedKey}
              showMarketLink={showMarket}
              onViewMarketData={() => setOpen(true)}
              onOfferClick={() => setOfferOpen(true)}
              onAcceptOfferClick={() => setAcceptOpen(true)}
              onListClick={() => setListOpen(true)}
              onModeChange={setMode}
              topOfferPrice={topOffer?.price ?? null}
            />
          </div>

          <div className="mt-6">
            <TrustBadges />
          </div>

          {/* Grade ladder — picking a grade here drives the buy box above.
              Grouped by company and fixed in layout so it reads the same on
              every card. */}
          <GradeSelector
            variants={variants}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
          />
        </div>
      </div>

      <OfferModal
        open={offerOpen}
        onClose={() => setOfferOpen(false)}
        cardId={cardId}
        cardName={cardName}
        initialCompany={filter?.company ?? null}
        initialGrade={filter?.grade ?? null}
        existingOffer={existingOwnOffer ? { id: existingOwnOffer.id, price: existingOwnOffer.price } : null}
        lowestAskPrice={lowestAsk}
        topOfferPrice={topOffer?.price ?? null}
        marketPrice={isRaw ? marketPrice : null}
        onPlaced={(bid) => {
          // Optimistically append the new bid so it shows up in the
          // market drawer's Offers tab + flows into the buy-panel
          // top-offer pill without waiting for a page reload.
          setBidsState(prev => [{
            id: bid.id,
            price: Number(bid.price),
            grading_company: bid.grading_company,
            grade: bid.grade,
            created_at: bid.created_at,
            buyerName: 'You',
            userId: bid.user_id,
          }, ...prev])
        }}
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

      <ListModal
        open={listOpen}
        onClose={() => setListOpen(false)}
        cardId={cardId}
        cardName={cardName}
        company={filter?.company ?? null}
        grade={filter?.grade ?? null}
        variants={variants}
        selectedKey={selectedKey}
        onSelectVariant={setSelectedKey}
        topOfferPrice={topOffer?.price ?? null}
        marketPrice={marketPrice}
        existingOwnListings={existingOwnListings.map(l => ({ id: l.id, price: l.price }))}
        onListed={(placed) => {
          // Optimistic append so the new listing shows up in the
          // Listings tab and (if it's the new lowest) the chip-row
          // price + Buy panel without a reload.
          setAsksState(prev => {
            const next: AskInput = {
              id: placed.id,
              price: placed.price,
              condition: placed.condition as AskInput['condition'],
              grading_company: placed.grading_company,
              grade: placed.grade,
              quantity_available: placed.quantity_available,
              created_at: placed.created_at,
              sellerName: 'You',
              sellerId: currentUserId ?? '',
            }
            return [...prev, next].sort((a, b) => a.price - b.price)
          })
        }}
      />

      {showMarket && <div id="market" className="mt-8">
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
              asks={filteredAsks.map(a => ({
                ...a,
                isYou: currentUserId != null && a.sellerId === currentUserId,
              }))}
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
              modeBias={mode}
              onCancelOffer={async (bidId: string) => {
                // Optimistic remove — the row disappears from the table
                // immediately. On failure we restore + alert.
                const snapshot = bidsState
                setBidsState(prev => prev.filter(b => b.id !== bidId))
                const res = await fetch(`/api/bids?id=${bidId}`, { method: 'DELETE' })
                if (!res.ok) {
                  setBidsState(snapshot)
                  alert('Failed to cancel offer.')
                }
              }}
              onCancelListing={async (listingId) => {
                // Optimistic remove from asks. Soft-delete (status='delisted')
                // via direct supabase write — listings RLS lets the owner
                // do this. Hard DELETE would fail if the listing has any
                // order history; delist is the universally-safe verb.
                const snapshot = asksState
                setAsksState(prev => prev.filter(a => a.id !== listingId))
                const { error } = await supabase
                  .from('listings')
                  .update({ status: 'delisted' })
                  .eq('id', listingId)
                if (error) {
                  setAsksState(snapshot)
                  alert('Failed to cancel listing.')
                }
              }}
              onUpdateOffer={async (bidId, newPrice) => {
                // Optimistic price update — row reorders instantly. On
                // failure we restore the previous state + alert.
                const snapshot = bidsState
                setBidsState(prev => prev.map(b => b.id === bidId ? { ...b, price: newPrice } : b))
                const res = await fetch(`/api/bids/${bidId}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ price: newPrice }),
                })
                if (!res.ok) {
                  const body = await res.json().catch(() => ({}))
                  setBidsState(snapshot)
                  alert(body.error || 'Failed to update offer.')
                }
              }}
              lowestAskPrice={lowestAsk}
              topOfferPrice={topOffer?.price ?? null}
            />
          </div>
        )}
      </div>}
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
