'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
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
  const [cardImages, setCardImages] = useState<Record<string, string>>({})
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

      // Fetch card images for order items without snapshots
      const cardIds = [...new Set<string>(activeOrders.flatMap((o: Order) =>
        (o.items || []).filter(i => !i.snapshot_photo_url).map(i => i.card_id)
      ))]
      const images: Record<string, string> = {}
      await Promise.all(
        cardIds.map(async (cardId: string) => {
          try {
            const r = await fetch(`/api/cards?id=${encodeURIComponent(cardId)}`)
            const d = await r.json()
            if (d.card?.imageUrl) images[cardId] = d.card.imageUrl
          } catch { /* skip */ }
        })
      )
      setCardImages(images)
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
                  {(firstItem?.snapshot_photo_url || firstItem?.card_id ? cardImages[firstItem.card_id] : undefined) ? (
                    <Image
                      src={firstItem?.snapshot_photo_url || (firstItem?.card_id ? cardImages[firstItem.card_id] : '') || ''}
                      alt={firstItem?.card_name || ''}
                      width={64}
                      height={89}
                      className="w-16 h-[89px] rounded-lg object-cover flex-shrink-0"
                      unoptimized
                    />
                  ) : (
                    <div className="w-16 h-[89px] rounded-lg bg-zinc-100 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-zinc-900 truncate">
                      {firstItem?.card_name || `Order #${order.id.slice(0, 8)}`}
                    </p>
                    <p className="text-sm text-zinc-500 mt-0.5">
                      {new Date(order.created_at).toLocaleDateString()}
                    </p>
                    <span className={`inline-block text-xs px-2 py-0.5 rounded mt-1 font-medium ${STATUS_STYLES[order.status] || ''}`}>
                      {STATUS_LABELS[order.status] || order.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-bold text-lg text-zinc-900">${Number(order.total).toFixed(2)}</p>
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
