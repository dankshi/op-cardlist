'use client'

import { Suspense, useEffect, useState, useCallback, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import type { Order, OrderItem } from '@/types/database'
import { STATUS_ORDER, STATUS_STYLES, STATUS_LABELS, statusLabel, statusStyle } from '@/lib/admin/orderStatus'

export default function AdminOrdersPage() {
  return (
    <Suspense
      fallback={
        <div className="py-20 text-center">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      }
    >
      <OrdersInner />
    </Suspense>
  )
}

function OrdersInner() {
  const searchParams = useSearchParams()
  const statusFilter = searchParams.get('status')

  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [cardImages, setCardImages] = useState<Record<string, string>>({})
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(
    () => Object.fromEntries(STATUS_ORDER.map(s => [s.key, s.defaultOpen]))
  )

  useEffect(() => {
    let cancelled = false
    fetch('/api/search-index')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled || !data?.cards) return
        const map: Record<string, string> = {}
        for (const c of data.cards as Array<{ id: string; imageUrl: string }>) {
          if (c.imageUrl) map[c.id] = c.imageUrl
        }
        setCardImages(map)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const fetchOrders = useCallback(async () => {
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (statusFilter) params.set('status', statusFilter)
    params.set('limit', '200')

    const res = await fetch(`/api/admin/orders?${params}`)
    if (res.status === 403) {
      window.location.href = '/'
      return
    }
    const data = await res.json()
    setOrders(data.orders || [])
  }, [search, statusFilter])

  useEffect(() => {
    setLoading(true)
    fetchOrders().finally(() => setLoading(false))
  }, [fetchOrders])

  const grouped = useMemo(() => {
    const groups: Record<string, Order[]> = {}
    for (const o of orders) {
      ;(groups[o.status] ||= []).push(o)
    }
    return groups
  }, [orders])

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-zinc-900">Orders</h1>
          {statusFilter && (
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${statusStyle(statusFilter)}`}>
              {statusLabel(statusFilter)}
            </span>
          )}
        </div>
        {statusFilter ? (
          <Link
            href="/admin/orders"
            className="text-sm font-medium text-zinc-500 hover:text-zinc-800"
          >
            Clear filter — show all &rarr;
          </Link>
        ) : (
          <Link
            href="/admin/orders?status=under_review"
            className="text-sm font-medium text-amber-700 hover:text-amber-800 underline-offset-2 hover:underline"
          >
            Risk Review &rarr;
          </Link>
        )}
      </div>

      <div className="mb-6">
        <input
          type="text"
          placeholder="Search by order ID..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full max-w-md px-4 py-2 rounded-lg bg-white border border-zinc-200 text-zinc-900 placeholder-zinc-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
      </div>

      {loading ? (
        <div className="py-20 text-center">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : orders.length === 0 ? (
        <p className="text-zinc-500 text-center py-8">
          {statusFilter ? `No orders in "${statusLabel(statusFilter)}".` : 'No orders found.'}
        </p>
      ) : statusFilter ? (
        // Filtered: a single flat list — the dropdown already named the status.
        <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-zinc-100 text-sm text-zinc-500">
            {orders.length} order{orders.length === 1 ? '' : 's'}
          </div>
          <div className="divide-y divide-zinc-100">
            {orders.map(order => (
              <OrderRow key={order.id} order={order} cardImages={cardImages} />
            ))}
          </div>
        </div>
      ) : (
        // Unfiltered: grouped accordion by status.
        <div className="space-y-4">
          {STATUS_ORDER.map(({ key }) => {
            const list = grouped[key] || []
            if (list.length === 0) return null
            const open = openSections[key]
            return (
              <section key={key} className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenSections(p => ({ ...p, [key]: !p[key] }))}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-50 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <svg
                      className={`w-4 h-4 text-zinc-400 transition-transform ${open ? 'rotate-90' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_STYLES[key] || ''}`}>
                      {STATUS_LABELS[key] || key}
                    </span>
                    <span className="text-sm text-zinc-500">{list.length} order{list.length === 1 ? '' : 's'}</span>
                  </div>
                </button>
                {open && (
                  <div className="divide-y divide-zinc-100 border-t border-zinc-100">
                    {list.map(order => (
                      <OrderRow key={order.id} order={order} cardImages={cardImages} />
                    ))}
                  </div>
                )}
              </section>
            )
          })}
          {/* Any status we forgot to enumerate above — render it so the
              admin doesn't lose visibility on unexpected states. */}
          {Object.keys(grouped)
            .filter(k => !STATUS_ORDER.some(s => s.key === k))
            .map(key => (
              <section key={key} className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-zinc-100">
                  <span className="text-xs px-2 py-0.5 rounded font-medium bg-zinc-200 text-zinc-600">
                    {STATUS_LABELS[key] || key}
                  </span>
                  <span className="ml-3 text-sm text-zinc-500">{grouped[key].length} orders</span>
                </div>
                <div className="divide-y divide-zinc-100">
                  {grouped[key].map(order => (
                    <OrderRow key={order.id} order={order} cardImages={cardImages} />
                  ))}
                </div>
              </section>
            ))}
        </div>
      )}
    </div>
  )
}

function OrderRow({ order, cardImages }: { order: Order; cardImages: Record<string, string> }) {
  const verifiedCount = order.items?.filter(
    i => (i as OrderItem).intake_status === 'verified' || (i as OrderItem).intake_status === 'resolved'
  ).length || 0
  const flaggedCount = order.items?.filter(i => (i as OrderItem).intake_status === 'flagged').length || 0
  const totalItems = order.items?.length || 0

  return (
    <Link
      href={`/admin/orders/${order.id}`}
      className="flex items-center gap-4 px-4 py-3 hover:bg-zinc-50 transition-colors group"
    >
      <div className="flex -space-x-2 flex-shrink-0">
        {(order.items || []).slice(0, 3).map(item => {
          const img = cardImages[item.card_id]
          return img ? (
            <Image
              key={item.id}
              src={img}
              alt=""
              width={28}
              height={40}
              className="w-7 h-10 object-cover rounded-sm border border-white shadow-sm"
              unoptimized
            />
          ) : (
            <div key={item.id} className="w-7 h-10 rounded-sm bg-zinc-200 border border-white" />
          )
        })}
        {(order.items?.length || 0) > 3 && (
          <div className="w-7 h-10 rounded-sm bg-zinc-100 border border-white text-xs text-zinc-500 flex items-center justify-center">
            +{(order.items?.length || 0) - 3}
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-zinc-900 group-hover:text-indigo-600 transition-colors">
            #{order.id.slice(0, 8)}
          </span>
          {flaggedCount > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/10 text-red-600 font-medium">
              {flaggedCount} flagged
            </span>
          )}
          {totalItems > 0 && (order.status === 'received' || order.status === 'seller_shipped') && (
            <span className="text-xs text-zinc-500">
              {verifiedCount}/{totalItems} verified
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-zinc-500 truncate">
          <span className="truncate">{(order.buyer as { display_name: string })?.display_name || 'Unknown'}</span>
          <span>&larr;</span>
          <span className="truncate">{(order.seller as { display_name: string })?.display_name || 'Unknown'}</span>
          <span>&middot;</span>
          <span>{new Date(order.created_at).toLocaleDateString()}</span>
        </div>
      </div>

      <div className="text-right flex-shrink-0">
        <p className="font-bold text-zinc-900">${Number(order.total).toFixed(2)}</p>
        <p className="text-xs text-zinc-400 mt-0.5">{order.items?.length || 0} item{order.items?.length === 1 ? '' : 's'}</p>
      </div>

      <svg className="w-4 h-4 text-zinc-300 group-hover:text-zinc-500 transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  )
}
