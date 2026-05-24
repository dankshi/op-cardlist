'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import type { Order } from '@/types/database'

export type OrdersKind = 'sales' | 'purchases'

interface Props {
  orders: Order[]
  kind: OrdersKind
  /** card_id → image URL fallback when the order_item has no snapshot. */
  cardImages: Record<string, string>
  /** Order IDs the user has already reviewed — only used when kind='purchases'
   *  to surface a "Leave Review" CTA on delivered orders without a review. */
  reviewedOrderIds?: Set<string>
}

type SortOption = 'recent' | 'price-desc' | 'price-asc'

const SORT_LABELS: Record<SortOption, string> = {
  'recent': 'Most recent',
  'price-desc': 'Price: High to low',
  'price-asc': 'Price: Low to high',
}

// Shared status badge palette — matches the colors used in the legacy
// vertical-list view so the visual language stays consistent.
const STATUS_BADGE_STYLES: Record<string, string> = {
  under_review: 'bg-amber-500/90 text-white',
  paid: 'bg-yellow-500/90 text-white',
  seller_shipped: 'bg-blue-500/90 text-white',
  received: 'bg-purple-500/90 text-white',
  authenticated: 'bg-emerald-500/90 text-white',
  shipped_to_buyer: 'bg-blue-500/90 text-white',
  shipped: 'bg-blue-500/90 text-white',
  delivered: 'bg-green-500/90 text-white',
}

const SALES_STATUS_LABELS: Record<string, string> = {
  under_review: 'Under Review',
  paid: 'Awaiting Shipment',
  seller_shipped: 'Shipped to Nomi',
  received: 'Received by Nomi',
  authenticated: 'Authenticated',
  shipped_to_buyer: 'Shipped to Buyer',
  shipped: 'Shipped',
  delivered: 'Delivered',
}

const PURCHASE_STATUS_LABELS: Record<string, string> = {
  under_review: 'Order Under Review',
  paid: 'Awaiting Seller',
  seller_shipped: 'Seller Shipped to Nomi',
  received: 'Nomi Received Card',
  authenticated: 'Card Authenticated',
  shipped_to_buyer: 'On Its Way to You',
  shipped: 'On Its Way to You',
  delivered: 'Delivered',
}

/** Visual binder of orders, mirroring StorefrontGrid's card-tile aesthetic.
 *  Reused for both Sales (seller perspective) and Purchases (buyer
 *  perspective) so /mystuff feels cohesive — every tab is a grid of card
 *  tiles, just with perspective-aware metadata and CTAs. */
export function OrdersGrid({ orders, kind, cardImages, reviewedOrderIds }: Props) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortOption>('recent')

  const visibleOrders = useMemo(() => {
    const q = query.trim().toLowerCase()
    const tokens = q.length === 0 ? [] : q.split(/\s+/)
    return orders
      .filter(o => {
        if (tokens.length === 0) return true
        const haystack = `${(o.items || []).map(i => i.card_name).join(' ')} ${o.id}`.toLowerCase()
        return tokens.every(t => haystack.includes(t))
      })
      .sort((a, b) => {
        switch (sort) {
          case 'price-desc': return Number(b.total) - Number(a.total)
          case 'price-asc': return Number(a.total) - Number(b.total)
          case 'recent':
          default: return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        }
      })
  }, [orders, query, sort])

  const emptyCopy = kind === 'sales'
    ? { none: 'No sales yet. Once a buyer purchases one of your listings, it shows up here.' }
    : { none: "You haven't bought any cards yet." }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[240px]">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
          </svg>
          <input
            type="text"
            placeholder={kind === 'sales' ? 'Search your sales…' : 'Search your purchases…'}
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full pl-10 pr-9 py-2.5 bg-white border border-zinc-200 rounded-lg text-zinc-900 placeholder:text-zinc-400 text-sm focus:outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900/5 transition-all"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 inline-flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
            >
              ×
            </button>
          )}
        </div>

        <div className="relative">
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortOption)}
            className="appearance-none pl-3 pr-8 py-2 rounded-md border border-zinc-200 bg-white text-sm font-medium text-zinc-900 hover:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/5 transition-colors cursor-pointer"
          >
            {(Object.keys(SORT_LABELS) as SortOption[]).map(opt => (
              <option key={opt} value={opt}>{SORT_LABELS[opt]}</option>
            ))}
          </select>
          <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      <p className="text-xs text-zinc-500 mb-4">
        Showing {visibleOrders.length} of {orders.length} {kind === 'sales' ? 'sale' : 'purchase'}{visibleOrders.length === 1 ? '' : 's'}.
      </p>

      {visibleOrders.length === 0 ? (
        <div className="text-center py-16 text-zinc-500">
          <p>{orders.length === 0 ? emptyCopy.none : 'Nothing matches your search.'}</p>
          {orders.length === 0 && kind === 'purchases' && (
            <Link href="/" className="mt-3 inline-block text-orange-500 hover:text-orange-600 font-medium">
              Browse cards →
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-x-4 gap-y-6">
          {visibleOrders.map(order => (
            <OrderTile
              key={order.id}
              order={order}
              kind={kind}
              cardImages={cardImages}
              reviewedOrderIds={reviewedOrderIds}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function OrderTile({
  order,
  kind,
  cardImages,
  reviewedOrderIds,
}: {
  order: Order
  kind: OrdersKind
  cardImages: Record<string, string>
  reviewedOrderIds?: Set<string>
}) {
  const items = order.items || []
  const firstItem = items[0]
  const extraItemCount = Math.max(0, items.length - 1)
  const imageUrl = firstItem?.snapshot_photo_url
    || (firstItem?.card_id ? cardImages[firstItem.card_id] : null)
    || null

  const labels = kind === 'sales' ? SALES_STATUS_LABELS : PURCHASE_STATUS_LABELS
  const statusLabel = labels[order.status] || order.status.replace(/_/g, ' ')
  const statusClass = STATUS_BADGE_STYLES[order.status] || 'bg-zinc-700/90 text-white'

  // Perspective-specific subtitle line under the card name.
  const subtitle = kind === 'sales'
    ? `Buyer: ${(order.buyer as { display_name?: string })?.display_name || 'Unknown'}`
    : new Date(order.created_at).toLocaleDateString()

  // Primary CTA per status. The whole tile is also clickable, but a visible
  // CTA makes the "what should I do next" obvious instead of buried inside
  // the order detail page.
  const cta = pickCta(order, kind, reviewedOrderIds)

  return (
    <Link href={`/orders/${order.id}`} className="block group">
      <div className="aspect-[2.5/3.5] relative rounded-lg overflow-hidden bg-zinc-100 ring-1 ring-zinc-100 group-hover:ring-zinc-300 transition-all">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={firstItem?.card_name || `Order ${order.id.slice(0, 8)}`}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 20vw"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-400 text-xs">
            no image
          </div>
        )}
        <div className="absolute top-2 left-2">
          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider backdrop-blur-sm ${statusClass}`}>
            {statusLabel}
          </span>
        </div>
        {extraItemCount > 0 && (
          <div className="absolute top-2 right-2">
            <span className="px-2 py-0.5 rounded bg-zinc-900/80 text-white text-[10px] font-semibold backdrop-blur-sm">
              +{extraItemCount} more
            </span>
          </div>
        )}
      </div>

      <div className="mt-2 space-y-1">
        <p className="text-sm font-semibold text-zinc-900 truncate" title={firstItem?.card_name || ''}>
          {firstItem?.card_name || `Order #${order.id.slice(0, 8)}`}
        </p>
        <p className="text-xs text-zinc-500 truncate">{subtitle}</p>
        <div className="flex items-end justify-between gap-2 pt-1">
          <span className="text-base font-semibold tabular-nums text-zinc-900">
            ${Number(order.total).toFixed(2)}
          </span>
          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold uppercase tracking-wider transition-colors ${cta.className}`}>
            {cta.label}
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </span>
        </div>
      </div>
    </Link>
  )
}

/** Choose the primary call-to-action shown on the tile based on what the
 *  user is actually blocked on for this order. The button is purely visual —
 *  clicking the tile always navigates to /orders/[orderId], where the real
 *  flows (print-label form, delivery confirmation, review form) live. */
function pickCta(
  order: Order,
  kind: OrdersKind,
  reviewedOrderIds?: Set<string>,
): { label: string; className: string } {
  if (kind === 'sales') {
    if (order.status === 'paid' && !order.seller_label_url) {
      return {
        label: 'Print Label',
        className: 'text-orange-600 ring-1 ring-orange-500/40 bg-white group-hover:bg-orange-500 group-hover:text-white group-hover:ring-orange-500',
      }
    }
    if (order.status === 'paid' && order.seller_label_url) {
      return {
        label: 'View Label',
        className: 'text-zinc-700 ring-1 ring-zinc-300 bg-white group-hover:bg-zinc-900 group-hover:text-white group-hover:ring-zinc-900',
      }
    }
  } else {
    if (order.status === 'shipped_to_buyer') {
      return {
        label: 'Confirm Receipt',
        className: 'text-emerald-700 ring-1 ring-emerald-500/40 bg-white group-hover:bg-emerald-600 group-hover:text-white group-hover:ring-emerald-600',
      }
    }
    if (order.status === 'delivered' && reviewedOrderIds && !reviewedOrderIds.has(order.id)) {
      return {
        label: 'Leave Review',
        className: 'text-orange-600 ring-1 ring-orange-500/40 bg-white group-hover:bg-orange-500 group-hover:text-white group-hover:ring-orange-500',
      }
    }
  }
  return {
    label: 'View',
    className: 'text-zinc-700 ring-1 ring-zinc-300 bg-white group-hover:bg-zinc-900 group-hover:text-white group-hover:ring-zinc-900',
  }
}
