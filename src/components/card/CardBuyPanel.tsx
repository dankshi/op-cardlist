'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { BuyNowButton } from '@/components/marketplace/BuyNowButton'
import { PriceChangeBadge } from '@/components/PriceChangeBadge'
import { gradingStyle } from '@/lib/gradingStyle'

export interface VariantData {
  /** Stable variant key: 'raw' or '<company>-<grade>' (e.g. 'PSA-10'). */
  key: string
  /** Display label: 'Raw' or '<company> <grade>'. */
  label: string
  company: string | null
  grade: string | null
  /** Population count for this graded variant (0 for raw / no data). */
  population: number
  lowestListingId: string | null
  lowestListingPrice: number | null
  listingCount: number
}

type CompanyKey = 'PSA' | 'BGS' | 'CGC' | 'TAG'

interface VariantDef {
  company: CompanyKey
  grade: string
  display: string // short label shown on the chip
  /** True if this chip is shown by default; false if it's behind the
   *  "+N more" expander. Order in this array is the render order — when
   *  expanded, secondary chips appear adjacent to their primary siblings
   *  (e.g. PSA 9 sits right after PSA 10 instead of jumping to the end). */
  primary: boolean
}

/** Canonical ordering for the chip row. Grouped by company so when the
 *  user expands the row, lower grades sit next to their company's top
 *  grade rather than being lumped together at the end. */
const ALL_VARIANTS: VariantDef[] = [
  { company: 'PSA', grade: '10',              display: '10',       primary: true  },
  { company: 'PSA', grade: '9',               display: '9',        primary: false },
  { company: 'BGS', grade: 'Black Label 10',  display: 'BL',       primary: true  },
  { company: 'BGS', grade: '10',              display: '10',       primary: true  },
  { company: 'BGS', grade: '9.5',             display: '9.5',      primary: false },
  { company: 'BGS', grade: '9',               display: '9',        primary: false },
  { company: 'CGC', grade: 'Pristine 10',     display: 'Pristine', primary: false },
  { company: 'CGC', grade: '10',              display: '10',       primary: false },
  { company: 'CGC', grade: '9.5',             display: '9.5',      primary: false },
  { company: 'CGC', grade: '9',               display: '9',        primary: false },
  { company: 'TAG', grade: '10',              display: '10',       primary: false },
  { company: 'TAG', grade: '9.5',             display: '9.5',      primary: false },
  { company: 'TAG', grade: '9',               display: '9',        primary: false },
]

interface ChipData {
  key: string
  label: string                    // long label for the panel header
  companyKey: CompanyKey | null
  /** Actual grade string (e.g. "Black Label 10") — fed to gradingStyle()
   *  so the chip can render the correct slab-label color treatment. */
  grade: string | null
  display: string | null           // short grade text on the chip face
  population: number
  lowestListingId: string | null
  lowestListingPrice: number | null
  listingCount: number
}

export function CardBuyPanel({
  cardId,
  variants,
  marketPrice,
  priceChangePercent,
  selectedKey: controlledKey,
  onSelect,
  onViewMarketData,
  onOfferClick,
  onAcceptOfferClick,
  topOfferPrice,
}: {
  cardId: string
  variants: VariantData[]
  marketPrice: number | null
  priceChangePercent: number | null
  /** When provided, the panel becomes controlled — parent owns the
   *  selected variant so a sibling (e.g. the inline market-data drawer)
   *  can render with the same filter. */
  selectedKey?: string
  onSelect?: (key: string) => void
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
  /** Highest open offer price for the currently-selected variant.
   *  Surfaces an "Accept" CTA so sellers don't have to drill into the
   *  Offers tab to find the matching bid. */
  topOfferPrice?: number | null
}) {
  const variantByKey = useMemo(() => {
    const m = new Map<string, VariantData>()
    for (const v of variants) m.set(v.key, v)
    return m
  }, [variants])

  type RenderableChip = ChipData & { primary: boolean }

  const allChips = useMemo<RenderableChip[]>(() => {
    const raw = variantByKey.get('raw')
    const rawChip: RenderableChip = {
      key: 'raw',
      label: 'Ungraded NM',
      companyKey: null,
      grade: null,
      display: null,
      population: 0,
      lowestListingId: raw?.lowestListingId ?? null,
      lowestListingPrice: raw?.lowestListingPrice ?? null,
      listingCount: raw?.listingCount ?? 0,
      primary: true,
    }
    const graded: RenderableChip[] = ALL_VARIANTS.map(def => {
      const key = `${def.company}-${def.grade}`
      const v = variantByKey.get(key)
      return {
        key,
        label: `${def.company} ${def.grade}`,
        companyKey: def.company,
        grade: def.grade,
        display: def.display,
        population: v?.population ?? 0,
        lowestListingId: v?.lowestListingId ?? null,
        lowestListingPrice: v?.lowestListingPrice ?? null,
        listingCount: v?.listingCount ?? 0,
        primary: def.primary,
      }
    })
    return [rawChip, ...graded]
  }, [variantByKey])

  const secondaryCount = useMemo(
    () => allChips.filter(c => !c.primary).length,
    [allChips],
  )

  // Cheapest variant with a listing — drives both the initial selection
  // and whether we auto-expand the secondary row (if the cheapest sits
  // there, expanding keeps it visible from the first paint).
  const cheapestKey = useMemo(() => {
    const listed = allChips.filter(c => c.lowestListingPrice != null)
    if (listed.length === 0) return 'raw'
    return listed.sort((a, b) => (a.lowestListingPrice ?? 0) - (b.lowestListingPrice ?? 0))[0].key
  }, [allChips])

  const cheapestIsSecondary = !allChips.find(c => c.key === cheapestKey)?.primary
  const [uncontrolledKey, setUncontrolledKey] = useState(cheapestKey)
  // Buy vs Sell perspective toggle (StockX pattern). Default to buy — most
  // users on a card page are shopping. They flip to sell via the contextual
  // footer link, which shows the top-offer price as a teaser.
  const [mode, setMode] = useState<'buy' | 'sell'>('buy')
  // Controlled when the parent passes `selectedKey`; uncontrolled when it
  // doesn't. Lets CardBuyPanel keep working standalone (e.g. on /market)
  // while also slotting into CardMainPanel where state lifts up.
  const selectedKey = controlledKey ?? uncontrolledKey
  const [expanded, setExpanded] = useState(cheapestIsSecondary)

  const selected = allChips.find(c => c.key === selectedKey) ?? allChips[0]
  const isRaw = selected.key === 'raw'

  function pickChip(key: string) {
    if (onSelect) onSelect(key)
    else setUncontrolledKey(key)
    // If the user picked a secondary chip, keep the row expanded so they
    // can see what's adjacent without it collapsing under them.
    const picked = allChips.find(c => c.key === key)
    if (picked && !picked.primary) setExpanded(true)
  }

  const belowMarket =
    isRaw && selected.lowestListingPrice != null && marketPrice != null && marketPrice > selected.lowestListingPrice
      ? marketPrice - selected.lowestListingPrice
      : 0
  const belowMarketSignificant = belowMarket >= 1 && belowMarket / (marketPrice || 1) >= 0.03

  return (
    <div className="rounded-xl border-2 border-zinc-200 bg-white p-5">
      {/* Chip row. Primary row is always visible; "Show all grades"
          reveals lower grades and the minor companies (CGC, TAG). */}
      <div className="-mx-1 mb-4">
        <div className="flex flex-wrap gap-1.5 px-1">
          {/* Iterate the unified canonical-order list so that when the
              user expands, secondaries slot in beside their company group
              (PSA 9 immediately after PSA 10, BGS 9.5/9 after BGS 10, etc.)
              instead of all appearing in a clump at the end. */}
          {allChips.filter(c => c.primary || expanded).map(c => (
            <VariantChip key={c.key} chip={c} isActive={c.key === selectedKey} onClick={() => pickChip(c.key)} />
          ))}
          {!expanded ? (
            <button
              onClick={() => setExpanded(true)}
              className="flex-shrink-0 w-[170px] px-3 py-2.5 rounded-lg text-center transition-colors cursor-pointer border-2 border-dashed border-zinc-300 hover:border-zinc-500 text-xs font-bold text-zinc-600 hover:text-zinc-900 inline-flex items-center justify-center gap-1"
              title="Show CGC, TAG, and lower grades"
            >
              <span>+{secondaryCount} more</span>
            </button>
          ) : (
            <button
              onClick={() => setExpanded(false)}
              className="flex-shrink-0 px-3 py-2 rounded-lg text-xs font-semibold text-zinc-500 hover:text-zinc-900 transition-colors"
            >
              Show less
            </button>
          )}
        </div>
      </div>

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
                {selected.listingCount === 1 && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-rose-50 text-rose-700 ring-1 ring-rose-200">
                    Last one
                  </span>
                )}
                {belowMarketSignificant && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                    ${belowMarket.toFixed(2)} below market
                  </span>
                )}
              </div>
              <div className="flex items-end justify-between gap-3">
                <p className="text-4xl font-bold tabular-nums text-zinc-900 leading-none">
                  ${selected.lowestListingPrice.toFixed(2)}
                </p>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <OfferButton onClick={onOfferClick} cardId={cardId} />
                  <BuyNowButton listingId={selected.lowestListingId} price={selected.lowestListingPrice} size="lg" />
                </div>
              </div>
            </div>
          ) : (
            <div className="mb-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">Buy now for</p>
              <p className="text-2xl font-semibold text-zinc-500 mb-3">No listings yet</p>
              <div className="flex items-center gap-2 flex-shrink-0">
                <OfferButton onClick={onOfferClick} cardId={cardId} />
                <Link
                  href={
                    `/sell?card=${encodeURIComponent(cardId)}`
                    + (selected.companyKey ? `&grading_company=${selected.companyKey}` : '')
                    + (selected.grade ? `&grade=${encodeURIComponent(selected.grade)}` : '')
                  }
                  className="px-5 py-3 rounded-lg text-base font-semibold bg-orange-500 hover:bg-orange-600 text-white transition-colors"
                >
                  List yours
                </Link>
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
                <p className="text-4xl font-bold tabular-nums text-emerald-700 leading-none">
                  ${topOfferPrice.toFixed(2)}
                </p>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Link
                    href={
                      `/sell?card=${encodeURIComponent(cardId)}`
                      + (selected.companyKey ? `&grading_company=${selected.companyKey}` : '')
                      + (selected.grade ? `&grade=${encodeURIComponent(selected.grade)}` : '')
                    }
                    className="px-5 py-3 rounded-lg text-base font-semibold bg-white text-zinc-900 ring-2 ring-zinc-300 hover:ring-zinc-900 hover:bg-zinc-50 transition-colors"
                  >
                    List for more
                  </Link>
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
            <div className="mb-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">Sell now for</p>
              <p className="text-2xl font-semibold text-zinc-500 mb-3">No offers yet</p>
              <Link
                href={
                  `/sell?card=${encodeURIComponent(cardId)}`
                  + (selected.companyKey ? `&grading_company=${selected.companyKey}` : '')
                  + (selected.grade ? `&grade=${encodeURIComponent(selected.grade)}` : '')
                }
                className="inline-flex px-5 py-3 rounded-lg text-base font-semibold bg-orange-500 hover:bg-orange-600 text-white transition-colors"
              >
                List your card
              </Link>
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
              ? <>Sell yours now for <span className="tabular-nums">${topOfferPrice.toFixed(2)}</span> →</>
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
        {onViewMarketData ? (
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
        )}
      </div>
    </div>
  )
}

function VariantChip({ chip, isActive, onClick }: { chip: ChipData; isActive: boolean; onClick: () => void }) {
  const hasListing = chip.lowestListingPrice != null
  const isGraded = chip.companyKey !== null
  const style = isGraded ? gradingStyle(chip.companyKey, chip.grade) : null
  return (
    <button
      onClick={onClick}
      className={`flex-shrink-0 w-[170px] px-3 py-2.5 rounded-lg text-left transition-colors cursor-pointer border-2 ${
        isActive
          ? 'border-orange-500 bg-orange-50'
          : 'border-zinc-200 bg-white hover:border-zinc-400'
      }`}
    >
      {/* Top row: tier-styled slab pill on the left, POP on the right.
          The pill itself signals quality at a glance (BGS BL = black/gold,
          BGS 10 = gold, PSA red, CGC green, etc.). Pop sits next to it so
          buyers read "BGS BL · Pop 12" without scanning down. */}
      <div className="flex items-center justify-between gap-2 mb-2">
        {style ? (
          <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ring-1 whitespace-nowrap ${style.pill}`}
          >
            {style.isCrownJewel && (
              <svg className="w-2.5 h-2.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.539 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
            )}
            {style.shortLabel}
          </span>
        ) : (
          /* Ungraded chip: zinc pill (no brand color since it isn't a
             grading company). The "NM" condition tag mirrors the Pop
             tag on graded chips — both live on the right side of the
             top row so the layout reads the same regardless of variant. */
          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-zinc-200 text-zinc-700 ring-1 ring-zinc-300">
            Ungraded
          </span>
        )}
        {isGraded ? (
          <span className="text-[10px] text-zinc-500 whitespace-nowrap flex-shrink-0">
            <span className="font-bold uppercase tracking-wider">Pop</span>{' '}
            <span className="tabular-nums font-semibold text-zinc-700">
              {chip.population.toLocaleString()}
            </span>
          </span>
        ) : (
          <span className={`text-[10px] font-bold uppercase tracking-wider whitespace-nowrap flex-shrink-0 ${isActive ? 'text-orange-700' : 'text-zinc-700'}`}>
            NM
          </span>
        )}
      </div>

      {/* Bottom row: lowest listing price. */}
      <div>
        {hasListing ? (
          <span className={`text-base font-bold tabular-nums ${isActive ? 'text-orange-600' : 'text-zinc-900'}`}>
            ${chip.lowestListingPrice!.toFixed(0)}
          </span>
        ) : (
          <span className="text-xs text-zinc-400 font-medium">0 listings</span>
        )}
      </div>
    </button>
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
