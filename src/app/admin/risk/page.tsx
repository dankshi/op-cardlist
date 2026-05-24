'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Order } from '@/types/database'

// Risk-inbox row only needs a couple of profile fields joined in, not the
// full Profile type. Use Omit to bypass the Order interface's full-Profile
// shape on `buyer`/`seller`.
type RiskRow = Omit<Order, 'buyer' | 'seller'> & {
  buyer?: { display_name: string | null; created_at: string | null }
  seller?: { display_name: string | null }
}

const REASON_LABELS: Record<string, string> = {
  self_dealing_same_ip: 'Buyer & seller share IP',
  self_dealing_account_proximity: 'Accounts created within 24 hrs',
  first_listing_rush: "Seller's first listing, new buyer",
}

function riskLevelStyle(level: string | null): string {
  if (level === 'highest') return 'bg-rose-500/10 text-rose-700'
  if (level === 'elevated') return 'bg-amber-500/10 text-amber-700'
  return 'bg-zinc-200 text-zinc-600'
}

export default function AdminRiskInboxPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [orders, setOrders] = useState<RiskRow[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchOrders = useCallback(async () => {
    const { data, error: queryError } = await supabase
      .from('orders')
      .select(`
        *,
        buyer:profiles!orders_buyer_id_fkey(display_name, created_at),
        seller:profiles!orders_seller_id_fkey(display_name)
      `)
      .eq('status', 'under_review')
      .order('risk_score', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })

    if (queryError) {
      console.error('[admin/risk] orders fetch failed', queryError)
      setError(queryError.message)
      return
    }
    setOrders((data as RiskRow[]) || [])
  }, [supabase])

  useEffect(() => {
    async function init() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { router.push('/auth/sign-in'); return }

        const { data: profile } = await supabase
          .from('profiles')
          .select('is_admin')
          .eq('id', user.id)
          .single()
        if (!profile?.is_admin) { router.push('/'); return }

        await fetchOrders()
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [supabase, router, fetchOrders])

  async function handleAction(orderId: string, action: 'approve' | 'refund') {
    if (actionLoading) return
    if (action === 'refund' && !confirm('Refund this order? The card will be refunded immediately and the buyer will be notified.')) {
      return
    }
    setActionLoading(`${orderId}:${action}`)
    setError(null)
    try {
      const res = await fetch(`/api/admin/risk/${orderId}/${action}`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }))
        setError(data.error || `${action} failed`)
        return
      }
      await fetchOrders()
    } finally {
      setActionLoading(null)
    }
  }

  if (loading) return <div className="p-8 text-zinc-500">Loading risk inbox…</div>

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <nav className="text-sm text-zinc-500 mb-4">
        <Link href="/admin" className="hover:text-zinc-900">Admin</Link>
        <span className="mx-2">/</span>
        <span className="text-zinc-900">Risk Review</span>
      </nav>

      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold text-zinc-900">Risk Review</h1>
        <span className="text-sm text-zinc-500">{orders.length} pending</span>
      </header>

      {error && (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      )}

      {orders.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white py-16 text-center text-zinc-500">
          <p>No orders awaiting review.</p>
          <p className="text-xs mt-1">Stripe Radar or our marketplace risk checks will flag suspicious orders here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map(order => {
            const buyerAgeDays = order.buyer?.created_at
              ? Math.floor((Date.now() - new Date(order.buyer.created_at).getTime()) / (24 * 60 * 60 * 1000))
              : null
            const auto = Array.isArray(order.auto_flagged_reasons) ? order.auto_flagged_reasons : []
            return (
              <div key={order.id} className="rounded-lg border border-zinc-200 bg-white p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Link href={`/orders/${order.id}`} className="font-medium text-zinc-900 hover:underline">
                        Order #{order.id.slice(0, 8)}
                      </Link>
                      {order.risk_level && (
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${riskLevelStyle(order.risk_level)}`}>
                          {order.risk_level}{order.risk_score != null ? ` · score ${order.risk_score}` : ''}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-zinc-600 space-x-2">
                      <span>${Number(order.total).toFixed(2)}</span>
                      <span className="text-zinc-300">·</span>
                      <span>
                        Buyer: <span className="text-zinc-900">{order.buyer?.display_name || '—'}</span>
                        {buyerAgeDays != null && (
                          <span className="text-zinc-400"> ({buyerAgeDays}d old)</span>
                        )}
                      </span>
                      <span className="text-zinc-300">·</span>
                      <span>Seller: <span className="text-zinc-900">{order.seller?.display_name || '—'}</span></span>
                      <span className="text-zinc-300">·</span>
                      <span>{new Date(order.created_at).toLocaleString()}</span>
                    </div>

                    {(order.review_reason || auto.length > 0) && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {order.review_reason && (
                          <span className="text-xs px-2 py-0.5 rounded bg-zinc-100 text-zinc-700">
                            Stripe: {order.review_reason}
                          </span>
                        )}
                        {auto.map(reason => (
                          <span key={reason} className="text-xs px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                            {REASON_LABELS[reason] || reason}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex-shrink-0 flex gap-2">
                    <button
                      onClick={() => handleAction(order.id, 'approve')}
                      disabled={!!actionLoading}
                      className="px-3 py-1.5 text-sm font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {actionLoading === `${order.id}:approve` ? 'Approving…' : 'Approve'}
                    </button>
                    <button
                      onClick={() => handleAction(order.id, 'refund')}
                      disabled={!!actionLoading}
                      className="px-3 py-1.5 text-sm font-medium rounded-md bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
                    >
                      {actionLoading === `${order.id}:refund` ? 'Refunding…' : 'Refund'}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
