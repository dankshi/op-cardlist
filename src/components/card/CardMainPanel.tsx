'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { CardBuyPanel, type VariantData } from './CardBuyPanel'
import { GradeSelector } from './GradeSelector'
import { TrustBadges } from './TrustBadges'
import { AddToCollectionButton } from '../collection/AddToCollectionButton'
import { CollectionPositionPanel, type PositionRow } from '../collection/CollectionPositionPanel'
import { useGradeSelection } from './GradeSelectionContext'
import { MarketTabs } from './MarketTabs'
import { OfferModal } from './OfferModal'
import { AcceptOfferModal } from './AcceptOfferModal'
import { ListModal } from './ListModal'
import { createClient } from '@/lib/supabase/client'
import { useAdminMarketData } from '@/lib/useAdminMarketData'
import { holdingMarketPrice } from '@/lib/collection'
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
  collection = [],
  slabValues = {},
  cardImageUrl = '',
}: {
  cardId: string
  cardName: string
  variants: VariantData[]
  marketPrice: number | null
  asks: AskInput[]
  bids: BidInput[]
  sales: SaleInput[]
  /** The viewer's own holdings of this card (the "In your collection"
   *  position panel). Empty when signed out or not owned. */
  collection?: PositionRow[]
  /** Computed slab comp values keyed "<company> <grade>" (override folded in).
   *  Used to re-value graded holdings after a client-side mutation so the
   *  position panel matches the server's valuation. */
  slabValues?: Record<string, number>
  /** Plain image URL for the collection editor (the 3D <image> slot can't be
   *  passed into a client modal). */
  cardImageUrl?: string
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
  // Local mirror of the viewer's holdings of this card. Mutations (quick-add,
  // editor save, remove) re-pull + re-value these client-side so the "In your
  // collection" panel reflects instantly without a server round-trip.
  const [collectionState, setCollectionState] = useState<PositionRow[]>(collection)
  const supabase = useMemo(() => createClient(), [])

  // Re-pull this card's collection rows and value them exactly like the server
  // page does: custom override → lowest active graded listing → raw market.
  const reloadCollection = useCallback(async () => {
    if (!currentUserId) return
    const { data } = await supabase
      .from('collections')
      .select('*')
      .eq('user_id', currentUserId)
      .eq('card_id', cardId)
      .gt('quantity', 0)

    const gradedMin = new Map<string, number>()
    for (const a of asksState) {
      if (a.grading_company && a.grade) {
        const key = `${a.grading_company}|${a.grade}`
        const cur = gradedMin.get(key)
        if (cur == null || a.price < cur) gradedMin.set(key, a.price)
      }
    }

    const rows: PositionRow[] = (data ?? []).map((c) => {
      const isGraded = !!(c.grading_company && c.grade)
      const market = holdingMarketPrice({
        customValue: c.custom_value != null ? Number(c.custom_value) : null,
        isGraded,
        slabValue: isGraded ? slabValues[`${c.grading_company} ${c.grade}`] ?? null : null,
        gradedListing: isGraded ? gradedMin.get(`${c.grading_company}|${c.grade}`) ?? null : null,
        rawMarket: marketPrice,
      })
      const qty = c.quantity as number
      const acq = c.acquired_price != null ? Number(c.acquired_price) : null
      const currentValue = market != null ? market * qty : null
      const costBasis = acq != null ? acq * qty : null
      const gain = currentValue != null && costBasis != null ? currentValue - costBasis : null
      const gainPct = gain != null && costBasis != null && costBasis > 0 ? gain / costBasis : null
      return {
        id: c.id as string,
        condition: c.condition ?? null,
        gradingCompany: c.grading_company ?? null,
        grade: c.grade ?? null,
        quantity: qty,
        acquiredPrice: acq,
        acquiredDate: c.acquired_date ?? null,
        customValue: c.custom_value != null ? Number(c.custom_value) : null,
        serialNumber: c.serial_number ?? null,
        currentValue,
        costBasis,
        gain,
        gainPct,
      }
    })
    setCollectionState(rows)
  }, [supabase, currentUserId, cardId, asksState, marketPrice, slabValues])

  // Keep the panel in sync when the server re-sends holdings (e.g. after a
  // router.refresh() following a save), not just after a client reloadCollection.
  useEffect(() => {
    setCollectionState(collection)
  }, [collection])
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
  // Publish the selected grade so the Recent Sales section can mirror it.
  const { setKey: publishGradeKey } = useGradeSelection()
  useEffect(() => {
    publishGradeKey(selectedKey)
  }, [selectedKey, publishGradeKey])
  const [open, setOpen] = useState(false)
  // Admin gate + per-admin toggle for the market-data drawer. Non-admins
  // never see it; admins can hide it from the profile dropdown.
  const [marketDataVisible] = useAdminMarketData()
  const showMarket = isAdmin && marketDataVisible
  const [offerOpen, setOfferOpen] = useState(false)
  const [acceptOpen, setAcceptOpen] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  // Collection line driving the open List modal, when "List for sale" was
  // clicked on a holding — threaded to the listing so the sale can close that
  // line's lots for realized P&L. Null when listing from the buy panel.
  const [listCollectionId, setListCollectionId] = useState<string | null>(null)
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
              onListClick={() => { setListCollectionId(null); setListOpen(true) }}
              onModeChange={setMode}
              topOfferPrice={topOffer?.price ?? null}
            />
          </div>

          {/* Only offer "Add to collection" when you don't already own it —
              otherwise the position panel below is the relevant surface. */}
          {collectionState.length === 0 && (
            <div className="mt-5">
              <AddToCollectionButton
                cardId={cardId}
                cardName={cardName}
                variant="button"
                onAdded={reloadCollection}
              />
            </div>
          )}

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

          {/* "In your collection" — your position on this card (Robinhood
              model), below the grades. Only renders when you own it. */}
          {collectionState.length > 0 && (
            <div className="mt-8">
              <CollectionPositionPanel
                cardId={cardId}
                cardName={cardName}
                imageUrl={cardImageUrl}
                rows={collectionState}
                onChanged={reloadCollection}
                onList={(row) => {
                  const key = row.gradingCompany && row.grade ? `${row.gradingCompany}-${row.grade}` : 'raw'
                  setSelectedKey(key)
                  setListCollectionId(row.id)
                  setListOpen(true)
                }}
              />
            </div>
          )}
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
        collectionId={listCollectionId}
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
