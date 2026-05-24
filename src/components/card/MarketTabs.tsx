'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ConditionBadge } from '@/components/marketplace/ConditionBadge'
import type { CardCondition } from '@/types/database'

interface AskRow {
  id: string
  price: number
  condition: CardCondition
  grading_company: string | null
  grade: string | null
  quantity_available: number
  created_at: string
  sellerName: string
}
interface BidRow {
  id: string
  price: number
  grading_company: string | null
  grade: string | null
  created_at: string
  buyerName: string
  /** Set when the buyer is the currently-logged-in user — flips the row
   *  to "Your offer" styling with a Cancel control. */
  isYou?: boolean
}
interface SaleRow {
  date: string
  price: number
  label: string
  source: string
}

type Tab = 'asks' | 'bids' | 'sales'

/** Tabbed market-data view: full ask ladder, full bid stack, recent sales.
 *  Lives on /card/[id]/market so the main card page can stay focused on
 *  the buy decision; power users come here for depth. */
export function MarketTabs({
  asks,
  bids,
  sales,
  cardId,
  bidsVariantFilter,
  onCancelOffer,
  onUpdateOffer,
  lowestAskPrice,
  topOfferPrice,
}: {
  asks: AskRow[]
  bids: BidRow[]
  sales: SaleRow[]
  cardId: string
  /** Filter context — only used now for the empty-state copy ("no offers
   *  on this variant"). The actual filtering happens upstream in
   *  CardMainPanel before the rows hit the table. */
  bidsVariantFilter?: { company: string | null; grade: string | null }
  onCancelOffer?: (bidId: string) => Promise<void> | void
  /** Quick-action update of an own offer's price. PATCH-style. */
  onUpdateOffer?: (bidId: string, newPrice: number) => Promise<void> | void
  /** Used to compute quick-action targets: "Match top" = topOffer + $1,
   *  "Match listing" = lowestAsk - $1. Hidden when unavailable. */
  lowestAskPrice?: number | null
  topOfferPrice?: number | null
}) {
  const [tab, setTab] = useState<Tab>('asks')

  // Honor #bids / #asks / #sales in the URL so the main card-page "Offer"
  // button can deep-link straight into the Bids tab.
  useEffect(() => {
    const hash = window.location.hash.replace('#', '')
    if (hash === 'asks' || hash === 'bids' || hash === 'sales') {
      setTab(hash as Tab)
    }
  }, [])

  return (
    <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
      <div className="flex items-center border-b border-zinc-200">
        {([
          { v: 'asks', label: 'Listings', count: asks.length },
          { v: 'bids', label: 'Offers', count: bids.length },
          { v: 'sales', label: 'Sales', count: sales.length },
        ] as { v: Tab; label: string; count: number }[]).map(t => (
          <button
            key={t.v}
            onClick={() => {
              setTab(t.v)
              // Keep URL hash in sync so a refresh / back-button preserves
              // which tab the user was looking at.
              if (typeof window !== 'undefined') {
                history.replaceState(null, '', `#${t.v}`)
              }
            }}
            className={`flex-1 py-3 text-sm font-semibold transition-colors cursor-pointer ${
              tab === t.v
                ? 'text-zinc-900 border-b-2 border-orange-500 bg-orange-50/50'
                : 'text-zinc-500 hover:text-zinc-700 border-b-2 border-transparent'
            }`}
          >
            {t.label}
            <span className={`ml-2 text-xs font-bold ${tab === t.v ? 'text-orange-600' : 'text-zinc-400'}`}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {tab === 'asks' && <AsksTable rows={asks} cardId={cardId} />}
      {tab === 'bids' && (
        <BidsTable
          rows={bids}
          onCancel={onCancelOffer}
          onUpdate={onUpdateOffer}
          lowestAsk={lowestAskPrice ?? null}
          topOffer={topOfferPrice ?? null}
        />
      )}
      {tab === 'sales' && <SalesTable rows={sales} />}
    </div>
  )
}

function AsksTable({ rows, cardId }: { rows: AskRow[]; cardId: string }) {
  if (rows.length === 0) {
    return (
      <div className="p-8 text-center text-zinc-500">
        <p className="mb-3">No listings for this variant.</p>
        <Link
          href={`/sell?card=${encodeURIComponent(cardId)}`}
          className="text-orange-600 hover:text-orange-700 font-semibold"
        >
          Be the first to list →
        </Link>
      </div>
    )
  }
  return (
    <div>
      {/* Listings table is intentionally minimal: just price + condition.
          Seller identity isn't decision-relevant on a verified-by-Nomi
          marketplace, and quantity is always 1 for graded slabs. Only the
          lowest is buyable — the higher rows exist as context. */}
      <Header cols={['Price', 'Condition']} layout="asks" />
      {rows.map((row) => (
        <div
          key={row.id}
          className="grid grid-cols-[1fr_2fr] items-center gap-3 px-4 py-3 border-b border-zinc-100 last:border-b-0"
        >
          <span className="text-base font-bold tabular-nums text-zinc-900">${row.price.toFixed(2)}</span>
          {/* justify-self-start prevents the inline-flex span from being
              stretched to fill its grid cell (default grid-item alignment
              is stretch, which made the pill span the entire column). */}
          <div className="justify-self-start">
            <ConditionBadge condition={row.condition} gradingCompany={row.grading_company} grade={row.grade} />
          </div>
        </div>
      ))}
    </div>
  )
}

function BidsTable({
  rows,
  onCancel,
  onUpdate,
  lowestAsk,
  topOffer,
}: {
  rows: BidRow[]
  onCancel?: (bidId: string) => Promise<void> | void
  onUpdate?: (bidId: string, newPrice: number) => Promise<void> | void
  lowestAsk: number | null
  topOffer: number | null
}) {
  const [busyId, setBusyId] = useState<string | null>(null)

  if (rows.length === 0) {
    return <div className="p-8 text-center text-zinc-500">No offers on this variant.</div>
  }
  return (
    <div>
      {/* Matches the Listings table format. Own offers get an action row
          underneath with quick adjustments ("Match top", "+$1", "+$5",
          "Cancel") so a buyer can compete without leaving the page. */}
      <Header cols={['Price', 'Variant']} layout="asks" />
      {rows.map((row) => {
        const isYours = !!row.isYou
        const isBusy = busyId === row.id
        async function update(price: number) {
          if (!onUpdate) return
          setBusyId(row.id)
          try { await onUpdate(row.id, price) } finally { setBusyId(null) }
        }
        async function cancel() {
          if (!onCancel) return
          setBusyId(row.id)
          try { await onCancel(row.id) } finally { setBusyId(null) }
        }

        // Quick-action targets. "Match top" outbids the current top
        // offer by $1; suppressed if you ARE the top. Increment buttons
        // are gated by lowestAsk so we never propose a price ≥ ask.
        const canPlus1 = lowestAsk == null || row.price + 1 < lowestAsk
        const canPlus5 = lowestAsk == null || row.price + 5 < lowestAsk
        const matchTopTarget = topOffer != null && topOffer > row.price
          ? topOffer + 1
          : null
        const canMatchTop = matchTopTarget != null && (lowestAsk == null || matchTopTarget < lowestAsk)

        return (
          <div
            key={row.id}
            className={`border-b border-zinc-100 last:border-b-0 ${isYours ? 'bg-orange-50/30' : ''}`}
          >
            <div className="grid grid-cols-[1fr_2fr] items-center gap-3 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-base font-bold tabular-nums text-zinc-900">${row.price.toFixed(2)}</span>
                {isYours && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 font-bold uppercase tracking-wider">
                    Your offer
                  </span>
                )}
              </div>
              <div className="justify-self-start">
                <ConditionBadge
                  condition={'near_mint' as CardCondition}
                  gradingCompany={row.grading_company}
                  grade={row.grade}
                />
              </div>
            </div>
            {isYours && (onUpdate || onCancel) && (
              <div className="flex items-center justify-end gap-1.5 px-4 pb-3 -mt-1 text-[11px]">
                {canMatchTop && onUpdate && (
                  <ActionChip onClick={() => update(matchTopTarget!)} disabled={isBusy}>
                    Match top (${matchTopTarget!.toFixed(0)})
                  </ActionChip>
                )}
                {canPlus1 && onUpdate && (
                  <ActionChip onClick={() => update(row.price + 1)} disabled={isBusy}>+$1</ActionChip>
                )}
                {canPlus5 && onUpdate && (
                  <ActionChip onClick={() => update(row.price + 5)} disabled={isBusy}>+$5</ActionChip>
                )}
                {onCancel && (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={cancel}
                    className="px-2 py-1 rounded text-[11px] font-semibold text-zinc-500 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait"
                  >
                    Cancel
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ActionChip({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-2 py-1 rounded text-[11px] font-semibold text-orange-700 ring-1 ring-orange-200 bg-white hover:bg-orange-100 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait whitespace-nowrap"
    >
      {children}
    </button>
  )
}

function SalesTable({ rows }: { rows: SaleRow[] }) {
  if (rows.length === 0) {
    return <div className="p-8 text-center text-zinc-500">No recent sales for this variant.</div>
  }
  return (
    <div>
      <Header cols={['Price', 'Variant', 'Date']} />
      {rows.map((row, idx) => (
        <div
          key={`${row.date}-${idx}`}
          className="grid grid-cols-[1fr_1.5fr_140px] items-center gap-3 px-4 py-3 border-b border-zinc-100 last:border-b-0"
        >
          <span className="text-base font-bold tabular-nums text-zinc-900">${row.price.toFixed(2)}</span>
          <span className="text-sm text-zinc-700">{row.label}</span>
          <span className="text-xs text-zinc-500">{new Date(row.date).toLocaleDateString()}</span>
        </div>
      ))}
    </div>
  )
}

function Header({ cols, layout = 'sales' }: { cols: string[]; layout?: 'asks' | 'bids' | 'sales' }) {
  const gridTemplate =
    layout === 'asks' ? '1fr 2fr'
    : layout === 'bids' ? '1fr 1.2fr 1.5fr 100px'
    : '1fr 1.5fr 140px'
  return (
    <div
      className="grid items-center gap-3 px-4 py-2 bg-zinc-50 border-b border-zinc-200 text-[10px] font-bold uppercase tracking-wider text-zinc-500"
      style={{ gridTemplateColumns: gridTemplate }}
    >
      {cols.map((c, i) => <span key={i}>{c}</span>)}
    </div>
  )
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diffMs / 86400_000)
  if (days < 1) return 'today'
  if (days === 1) return '1d ago'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}
