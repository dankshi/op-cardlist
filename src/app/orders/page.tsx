'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Order } from '@/types/database'

const STATUS_STYLES: Record<string, string> = {
  pending_payment: 'bg-zinc-200 text-zinc-600',
  paid: 'bg-yellow-500/10 text-yellow-400',
  shipped: 'bg-blue-500/10 text-blue-400',
  delivered: 'bg-green-500/10 text-green-400',
  cancelled: 'bg-red-500/10 text-red-400',
  refunded: 'bg-zinc-200 text-zinc-500',
  disputed: 'bg-red-500/10 text-red-400',
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
      setOrders(data.orders || [])
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
          {orders.map(order => (
            <Link
              key={order.id}
              href={`/orders/${order.id}`}
              className="block p-4 rounded-lg bg-white border border-zinc-200 hover:border-zinc-300 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-zinc-900">
                    Order #{order.id.slice(0, 8)}
                  </p>
                  <p className="text-sm text-zinc-500 mt-1">
                    {order.items?.length || 0} items &middot;{' '}
                    {new Date(order.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-zinc-900">${Number(order.total).toFixed(2)}</p>
                  <span className={`text-xs px-2 py-0.5 rounded ${STATUS_STYLES[order.status] || ''}`}>
                    {order.status.replace('_', ' ')}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
