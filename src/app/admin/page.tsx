'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Order, OrderItem } from '@/types/database'

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
}

const STATUS_LABELS: Record<string, string> = {
  pending_payment: 'Pending Payment',
  paid: 'Paid',
  seller_shipped: 'Seller Shipped',
  received: 'Received',
  authenticated: 'Authenticated',
  shipped_to_buyer: 'Shipped to Buyer',
  shipped: 'Shipped (legacy)',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}

const ACTIONABLE_STATUSES: Record<string, { nextStatus: string; label: string; buttonClass: string }> = {
  seller_shipped: { nextStatus: 'received', label: 'Mark Received', buttonClass: 'bg-purple-500 hover:bg-purple-600' },
  received: { nextStatus: 'authenticated', label: 'Mark Authenticated', buttonClass: 'bg-emerald-500 hover:bg-emerald-600' },
  authenticated: { nextStatus: 'shipped_to_buyer', label: 'Ship to Buyer', buttonClass: 'bg-blue-500 hover:bg-blue-600' },
}

const FILTER_STATUSES = ['all', 'paid', 'seller_shipped', 'received', 'authenticated', 'shipped_to_buyer', 'delivered']

export default function AdminPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({})
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [notesMap, setNotesMap] = useState<Record<string, string>>({})
  const router = useRouter()
  const supabase = createClient()

  const fetchOrders = useCallback(async () => {
    const params = new URLSearchParams()
    if (statusFilter !== 'all') params.set('status', statusFilter)
    if (search) params.set('search', search)
    params.set('limit', '50')

    const res = await fetch(`/api/admin/orders?${params}`)
    if (res.status === 403) {
      router.push('/')
      return
    }
    const data = await res.json()
    setOrders(data.orders || [])
  }, [statusFilter, search, router])

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth/sign-in'); return }

      const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single()

      if (!profile?.is_admin) { router.push('/'); return }

      // Fetch counts for each status
      const counts: Record<string, number> = {}
      for (const status of FILTER_STATUSES.filter(s => s !== 'all')) {
        const { count } = await supabase
          .from('orders')
          .select('*', { count: 'exact', head: true })
          .eq('status', status)
        counts[status] = count || 0
      }
      setStatusCounts(counts)

      await fetchOrders()
      setLoading(false)
    }
    init()
  }, [supabase, router, fetchOrders])

  useEffect(() => {
    if (!loading) fetchOrders()
  }, [statusFilter, search, fetchOrders, loading])

  async function handleStatusChange(orderId: string, nextStatus: string) {
    setActionLoading(orderId)
    const notes = notesMap[orderId] || ''

    const res = await fetch(`/api/admin/orders/${orderId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus, notes: notes || undefined }),
    })

    if (res.ok) {
      setNotesMap(prev => ({ ...prev, [orderId]: '' }))
      await fetchOrders()
      // Update counts
      const { count: oldCount } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('status', orders.find(o => o.id === orderId)?.status || '')
      const { count: newCount } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('status', nextStatus)
      setStatusCounts(prev => ({
        ...prev,
        [orders.find(o => o.id === orderId)?.status || '']: (oldCount || 0),
        [nextStatus]: (newCount || 0),
      }))
    } else {
      const data = await res.json()
      alert(data.error || 'Failed to update status')
    }
    setActionLoading(null)
  }

  if (loading) {
    return (
      <div className="py-20 text-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-zinc-900">Admin Panel</h1>
        <Link
          href="/admin/intake"
          className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-semibold hover:bg-orange-600 transition-colors"
        >
          Intake Scanner
        </Link>
      </div>

      {/* Status counts */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-8">
        {FILTER_STATUSES.filter(s => s !== 'all').map(status => (
          <button
            key={status}
            onClick={() => setStatusFilter(statusFilter === status ? 'all' : status)}
            className={`p-3 rounded-lg border text-center transition-colors cursor-pointer ${
              statusFilter === status
                ? 'border-orange-500 bg-orange-50'
                : 'border-zinc-200 bg-white hover:bg-zinc-50'
            }`}
          >
            <p className="text-xl font-bold text-zinc-900">{statusCounts[status] || 0}</p>
            <p className="text-xs text-zinc-500">{STATUS_LABELS[status] || status}</p>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="mb-6">
        <input
          type="text"
          placeholder="Search by order ID..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full max-w-md px-4 py-2 rounded-lg bg-white border border-zinc-200 text-zinc-900 placeholder-zinc-400 text-sm"
        />
      </div>

      {/* Orders list */}
      {orders.length === 0 ? (
        <p className="text-zinc-500 text-center py-8">No orders found.</p>
      ) : (
        <div className="space-y-4">
          {orders.map(order => {
            const action = ACTIONABLE_STATUSES[order.status]
            return (
              <div key={order.id} className="bg-white border border-zinc-200 rounded-lg p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <Link href={`/orders/${order.id}`} className="font-medium text-zinc-900 hover:text-orange-400 transition-colors">
                      Order #{order.id.slice(0, 8)}
                    </Link>
                    <div className="flex items-center gap-3 mt-1 text-sm text-zinc-500">
                      <span>Buyer: {(order.buyer as { display_name: string })?.display_name || 'Unknown'}</span>
                      <span>&middot;</span>
                      <span>Seller: {(order.seller as { display_name: string })?.display_name || 'Unknown'}</span>
                      <span>&middot;</span>
                      <span>{new Date(order.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-zinc-900">${Number(order.total).toFixed(2)}</p>
                    <span className={`text-xs px-2 py-0.5 rounded ${STATUS_STYLES[order.status] || ''}`}>
                      {STATUS_LABELS[order.status] || order.status}
                    </span>
                  </div>
                </div>

                {/* Items with intake status */}
                <div className="text-sm text-zinc-600 mb-3">
                  {order.items?.map(item => (
                    <span key={item.id} className="mr-3 inline-flex items-center gap-1">
                      <span className={`w-2 h-2 rounded-full inline-block ${
                        (item as OrderItem).intake_status === 'verified' ? 'bg-green-500' :
                        (item as OrderItem).intake_status === 'flagged' ? 'bg-red-500' :
                        (item as OrderItem).intake_status === 'resolved' ? 'bg-blue-500' :
                        'bg-zinc-300'
                      }`} />
                      {item.card_name} x{item.quantity}
                    </span>
                  ))}
                </div>
                {/* Intake progress */}
                {(order.status === 'received' || order.status === 'seller_shipped') && order.items && order.items.length > 0 && (() => {
                  const verified = order.items.filter(i => (i as OrderItem).intake_status === 'verified' || (i as OrderItem).intake_status === 'resolved').length
                  const flagged = order.items.filter(i => (i as OrderItem).intake_status === 'flagged').length
                  const total = order.items.length
                  return (
                    <div className="mb-3">
                      <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
                        <span>Intake: {verified}/{total} verified</span>
                        {flagged > 0 && <span className="text-red-500 font-medium">{flagged} flagged</span>}
                      </div>
                      <div className="w-full bg-zinc-100 rounded-full h-1.5">
                        <div
                          className={`h-1.5 rounded-full ${verified === total ? 'bg-green-500' : 'bg-orange-500'}`}
                          style={{ width: `${(verified / total) * 100}%` }}
                        />
                      </div>
                    </div>
                  )
                })()}

                {/* Tracking info */}
                {order.seller_tracking_number && (
                  <div className="text-xs text-zinc-500 mb-2">
                    Seller tracking: {order.seller_tracking_carrier && `${order.seller_tracking_carrier} — `}{order.seller_tracking_number}
                  </div>
                )}
                {order.tracking_number && (
                  <div className="text-xs text-zinc-500 mb-2">
                    Buyer tracking: {order.tracking_carrier && `${order.tracking_carrier} — `}{order.tracking_number}
                  </div>
                )}

                {/* Admin notes */}
                {order.admin_notes && (
                  <div className="bg-zinc-50 rounded p-2 mb-3 text-xs text-zinc-600 whitespace-pre-wrap">
                    {order.admin_notes}
                  </div>
                )}

                {/* Action area */}
                {action && (() => {
                  // Block authentication if items aren't all verified
                  const isAuthGated = action.nextStatus === 'authenticated' && order.items && order.items.some(
                    i => (i as OrderItem).intake_status !== 'verified' && (i as OrderItem).intake_status !== 'resolved'
                  )

                  return (
                    <div className="flex items-end gap-3 pt-3 border-t border-zinc-100">
                      <div className="flex-1">
                        <input
                          type="text"
                          placeholder="Add notes (optional)"
                          value={notesMap[order.id] || ''}
                          onChange={e => setNotesMap(prev => ({ ...prev, [order.id]: e.target.value }))}
                          className="w-full px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-200 text-zinc-900 placeholder-zinc-400 text-sm"
                        />
                      </div>
                      {isAuthGated ? (
                        <Link
                          href={`/admin/intake?orderId=${order.id}`}
                          className="px-4 py-2 rounded-lg bg-yellow-500 text-white font-semibold text-sm hover:bg-yellow-600 transition-colors"
                        >
                          Verify Items First
                        </Link>
                      ) : (
                        <button
                          onClick={() => handleStatusChange(order.id, action.nextStatus)}
                          disabled={actionLoading === order.id}
                          className={`px-4 py-2 rounded-lg text-white font-semibold text-sm transition-colors cursor-pointer disabled:opacity-50 ${action.buttonClass}`}
                        >
                          {actionLoading === order.id ? 'Processing...' : action.label}
                        </button>
                      )}
                    </div>
                  )
                })()}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
