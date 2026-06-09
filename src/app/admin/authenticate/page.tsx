'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { statusLabel, statusStyle } from '@/lib/admin/orderStatus'

// ============================================
// Types
// ============================================

interface QueueOrder {
  id: string
  shortId: string
  status: string
  sellerName: string
  receivedAt: string | null
  totalItems: number
  decidedItems: number
}

// Statuses where authentication is available. Mirrors the gate in
// /admin/authenticate/[orderId] and /api/admin/authenticate/scan.
const AUTH_STATUSES = ['received', 'exception_review']

// ============================================
// Page
// ============================================

export default function NeedAuthenticationPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [loading, setLoading] = useState(true)
  const [scanInput, setScanInput] = useState('')
  const [scanLoading, setScanLoading] = useState(false)
  const [error, setError] = useState('')
  const [queue, setQueue] = useState<QueueOrder[]>([])
  const [queueLoading, setQueueLoading] = useState(true)

  const scanRef = useRef<HTMLInputElement>(null)
  const didAuthCheck = useRef(false)

  // ── Load the authentication queue ──────────────────────────────
  // Orders awaiting authentication ('received') plus those parked in
  // 'exception_review'. We pull each order's items to show per-order
  // decision progress (X of Y decided).
  const loadQueue = useCallback(async () => {
    setQueueLoading(true)
    try {
      const { data: orders } = await supabase
        .from('orders')
        .select('id, status, seller_id, received_at, created_at, seller:profiles!orders_seller_id_fkey(display_name)')
        .in('status', AUTH_STATUSES)
        .order('received_at', { ascending: true, nullsFirst: false })

      const orderIds = (orders || []).map(o => o.id)
      const itemsByOrder: Record<string, { decided: number; total: number }> = {}
      if (orderIds.length > 0) {
        const { data: items } = await supabase
          .from('order_items')
          .select('order_id, auth_decision')
          .in('order_id', orderIds)
        for (const it of items || []) {
          const bucket = (itemsByOrder[it.order_id] ??= { decided: 0, total: 0 })
          bucket.total += 1
          if (it.auth_decision && it.auth_decision !== 'pending') bucket.decided += 1
        }
      }

      const mapped: QueueOrder[] = (orders || []).map(o => {
        const seller = Array.isArray(o.seller) ? o.seller[0] : o.seller
        const counts = itemsByOrder[o.id] || { decided: 0, total: 0 }
        return {
          id: o.id,
          shortId: o.id.slice(0, 8).toUpperCase(),
          status: o.status,
          sellerName: seller?.display_name || 'Unknown Seller',
          receivedAt: o.received_at,
          totalItems: counts.total,
          decidedItems: counts.decided,
        }
      })
      setQueue(mapped)
    } catch (err) {
      console.error('[authenticate] queue load failed', err)
    } finally {
      setQueueLoading(false)
    }
  }, [supabase])

  // ── Auth gate + initial load ───────────────────────────────────
  useEffect(() => {
    if (didAuthCheck.current) return
    didAuthCheck.current = true
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
        scanRef.current?.focus()
        await loadQueue()
      } catch (err) {
        console.error('[authenticate] init failed', err)
        setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [supabase, router, loadQueue])

  // ── Scan handler — resolve product QR / order ID → auth flow ────
  const handleScan = useCallback(async (input?: string) => {
    const raw = (input ?? scanInput).trim()
    if (!raw) return
    setScanLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/authenticate/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qr: raw }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Scan failed')
        return
      }
      if (data.ok) {
        setScanInput('')
        router.push(`/admin/authenticate/${data.order_id}`)
        return
      }
      // Soft reject (wrong label / status / not found) — show the hint.
      setError(data.detail || 'Could not pull up that order.')
    } catch {
      setError('Scan failed — check your connection')
    } finally {
      setScanLoading(false)
    }
  }, [scanInput, router])

  if (loading) {
    return (
      <div className="py-20 text-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  const awaiting = queue.filter(q => q.status === 'received').length
  const exceptions = queue.filter(q => q.status === 'exception_review').length

  return (
    <div>
      {/* Header — title left, ambient queue stats right. Mirrors Intake. */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Need Authentication</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Scan a product QR or order ID to pull up the authentication flow.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <div className="px-3 py-1.5 rounded-lg bg-purple-50 text-purple-700">
            <span className="font-bold tabular-nums">{awaiting}</span>{' '}
            <span className="text-purple-600">awaiting auth</span>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700">
            <span className="font-bold tabular-nums">{exceptions}</span>{' '}
            <span className="text-amber-600">in exception review</span>
          </div>
        </div>
      </div>

      {/* Always-visible scan input */}
      <div className="mb-8 max-w-2xl">
        <label className="block text-xs uppercase tracking-wide text-zinc-500 font-semibold mb-2">
          Scan Product QR / Order ID
        </label>
        <div className="relative">
          <input
            ref={scanRef}
            type="text"
            placeholder="Scanner will type here. Or paste a product ID / order ID."
            value={scanInput}
            onChange={e => setScanInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleScan() }}
            autoFocus
            className="w-full px-5 py-4 rounded-xl bg-white border-2 border-zinc-200 text-zinc-900 placeholder-zinc-400 text-lg font-mono focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-colors"
          />
          <button
            onClick={() => handleScan()}
            disabled={scanLoading}
            className="absolute right-3 top-1/2 -translate-y-1/2 px-4 py-2 bg-orange-500 text-white rounded-lg font-semibold text-sm hover:bg-orange-600 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {scanLoading ? 'Searching…' : 'Look Up'}
          </button>
        </div>
        {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
      </div>

      {/* Queue list */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-zinc-700">
          Authentication queue
          {!queueLoading && <span className="ml-2 text-zinc-400 font-normal">{queue.length}</span>}
        </h2>
        <button
          onClick={loadQueue}
          disabled={queueLoading}
          className="text-xs text-zinc-500 hover:text-zinc-800 disabled:opacity-50 cursor-pointer"
        >
          {queueLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {queueLoading && queue.length === 0 ? (
        <div className="py-12 text-center text-sm text-zinc-400">Loading queue…</div>
      ) : queue.length === 0 ? (
        <div className="py-12 text-center text-sm text-zinc-400 border border-dashed border-zinc-200 rounded-xl">
          Nothing waiting to authenticate. Scan a package above to begin.
        </div>
      ) : (
        <div className="divide-y divide-zinc-100 border border-zinc-200 rounded-xl overflow-hidden bg-white">
          {queue.map(o => (
            <Link
              key={o.id}
              href={`/admin/authenticate/${o.id}`}
              className="flex items-center gap-4 px-4 py-3 hover:bg-zinc-50 transition-colors"
            >
              <span className="font-mono text-sm text-zinc-900 w-20 flex-shrink-0">#{o.shortId}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${statusStyle(o.status)}`}>
                {statusLabel(o.status)}
              </span>
              <span className="text-sm text-zinc-600 flex-1 min-w-0 truncate">{o.sellerName}</span>
              <span className="text-xs text-zinc-500 flex-shrink-0 tabular-nums">
                {o.decidedItems}/{o.totalItems} decided
              </span>
              <svg className="w-4 h-4 text-zinc-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
