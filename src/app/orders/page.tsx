'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Order } from '@/types/database'

const STATUS_STYLES: Record<string, string> = {
  pending_payment: 'bg-zinc-200 text-zinc-600',
  paid: 'bg-yellow-500/10 text-yellow-400',
  seller_shipped: 'bg-blue-500/10 text-blue-400',
  received: 'bg-purple-500/10 text-purple-400',
  authenticated: 'bg-emerald-500/10 text-emerald-400',
  shipped_to_buyer: 'bg-blue-500/10 text-blue-400',
  shipped: 'bg-blue-500/10 text-blue-400',
  delivered: 'bg-green-500/10 text-green-400',
  cancelled: 'bg-red-500/10 text-red-400',
  refunded: 'bg-zinc-200 text-zinc-500',
  disputed: 'bg-red-500/10 text-red-400',
}

const STATUS_LABELS: Record<string, string> = {
  pending_payment: 'Pending Payment',
  paid: 'Paid',
  seller_shipped: 'Shipped to Platform',
  received: 'Received',
  authenticated: 'Authenticated',
  shipped_to_buyer: 'Shipped to You',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  disputed: 'Disputed',
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth/sign-in'); return }

      const res = await fetch('/api/orders?role=buyer')
      const data = await res.json()
      const activeOrders = (data.orders || []).filter(
        (o: Order) => o.status !== 'cancelled' && o.status !== 'pending_payment'
      )
      setOrders(activeOrders)
      setLoading(false)
    }
    load()
  }, [supabase, router])

  if (loading) {
    return (
      <div className="py-20 text-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold text-zinc-900 mb-8">My Orders</h1>

      {orders.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-zinc-500 mb-4">You haven&apos;t placed any orders yet.</p>
          <Link href="/" className="text-orange-400 hover:text-orange-600 font-medium">Browse cards</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map(order => {
            const firstItem = order.items?.[0]
            return (
              <Link
                key={order.id}
                href={`/orders/${order.id}`}
                className="block p-4 rounded-lg bg-white border border-zinc-200 hover:border-zinc-300 transition-colors"
              >
                <div className="flex items-center gap-4">
                  {firstItem?.snapshot_photo_url ? (
                    <img
                      src={firstItem.snapshot_photo_url}
                      alt={firstItem.card_name}
                      className="w-16 h-22 rounded-lg object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-16 h-22 rounded-lg bg-zinc-100 flex-shrink-0 flex items-center justify-center">
                      <svg className="w-6 h-6 text-zinc-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-zinc-900 truncate">
                      {firstItem?.card_name || `Order #${order.id.slice(0, 8)}`}
                    </p>
                    {(order.items?.length || 0) > 1 && (
                      <p className="text-xs text-zinc-400">+{(order.items?.length || 0) - 1} more</p>
                    )}
                    <p className="text-sm text-zinc-500 mt-1">
                      {new Date(order.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-bold text-zinc-900">${Number(order.total).toFixed(2)}</p>
                    <span className={`text-xs px-2 py-0.5 rounded ${STATUS_STYLES[order.status] || ''}`}>
                      {STATUS_LABELS[order.status] || order.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
