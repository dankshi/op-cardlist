'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getPrinterStatus, printZpl } from '@/lib/zebra'

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface PackItem {
  id: string
  card_name: string | null
  condition: string
  quantity: number
  image_url: string | null
}

interface ShippingAddress {
  name?: string
  line1?: string
  line2?: string
  city?: string
  state?: string
  zip?: string
  country?: string
  phone?: string
}

interface PackOrder {
  id: string
  buyer_name: string
  items: PackItem[]
  shipping_address: ShippingAddress
  shipping_cost: number
  item_count: number
}

type RejectReason =
  | 'not_found'
  | 'malformed'
  | 'wrong_label'
  | 'not_authenticated'
  | 'exception_review'
  | 'already_shipped'
  | 'missing_phone'
  | 'cancelled'

interface RejectState {
  reason: RejectReason
  order_id?: string
  detail?: string
  fixup_url?: string
  existing_label_url?: string
  tracking_number?: string
  tracking_carrier?: string
}

interface ShipResult {
  order_id: string
  label_url: string
  zpl: string | null
  tracking_number: string
  carrier: string
  cost: number
  printed: boolean
}

// ─────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────

export default function AdminPackPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [authChecked, setAuthChecked] = useState(false)
  const [scan, setScan] = useState('')
  const [looking, setLooking] = useState(false)
  const [preview, setPreview] = useState<PackOrder | null>(null)
  const [scannedItemId, setScannedItemId] = useState<string | null>(null)
  const [reject, setReject] = useState<RejectState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [shipping, setShipping] = useState(false)
  const [shipped, setShipped] = useState<ShipResult | null>(null)
  const [packedToday, setPackedToday] = useState(0)
  const [queueCount, setQueueCount] = useState<number | null>(null)
  const [printerStatus, setPrinterStatus] = useState<'ready' | 'offline' | 'error' | 'checking'>('checking')
  const scanRef = useRef<HTMLInputElement>(null)
  const didLoad = useRef(false)

  // Auth + initial counts.
  useEffect(() => {
    if (didLoad.current) return
    didLoad.current = true
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
        setAuthChecked(true)

        // Pack queue count = orders in 'authenticated' status.
        // Today's packed count = orders with shipped_to_buyer_at today.
        const startOfDay = new Date()
        startOfDay.setHours(0, 0, 0, 0)
        const [{ count: queue }, { count: packed }] = await Promise.all([
          supabase
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'authenticated'),
          supabase
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .gte('shipped_to_buyer_at', startOfDay.toISOString()),
        ])
        setQueueCount(queue ?? 0)
        setPackedToday(packed ?? 0)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load pack screen')
      }
    }
    init()
  }, [supabase, router])

  // Printer status — poll on mount, then every 30s. Mirrors intake.
  useEffect(() => {
    let alive = true
    async function check() {
      const status = await getPrinterStatus()
      if (alive) setPrinterStatus(status)
    }
    check()
    const id = setInterval(check, 30_000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  // Refocus scan input whenever we return to the idle state.
  useEffect(() => {
    if (!preview && !reject && !shipped && !shipping && authChecked) {
      scanRef.current?.focus()
    }
  }, [preview, reject, shipped, shipping, authChecked])

  // Resolve a scanned QR via the lookup endpoint.
  const lookup = useCallback(async (qr: string) => {
    setLooking(true)
    setError(null)
    setReject(null)
    setPreview(null)
    setScannedItemId(null)
    try {
      const res = await fetch('/api/admin/pack/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qr }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Lookup failed')
        return
      }
      if (!data.ok) {
        setReject(data as RejectState)
        return
      }
      setPreview(data.order as PackOrder)
      setScannedItemId(data.scanned_item_id ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setLooking(false)
    }
  }, [])

  function handleScanSubmit(e: React.FormEvent) {
    e.preventDefault()
    const value = scan.trim()
    if (!value || looking || shipping) return
    setScan('')
    lookup(value)
  }

  // The commit: generate the label + flip status + dispatch print.
  async function shipNow() {
    if (!preview || shipping) return
    setShipping(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/pack/ship/${preview.id}`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Ship failed')
        setShipping(false)
        return
      }

      // Direct-to-Zebra dispatch. ZPL is the happy path; if Shippo
      // couldn't deliver ZPL (rare) we fall back to opening the PDF
      // tab so the operator can print manually.
      let printed = false
      if (data.zpl) {
        printed = await printZpl(data.zpl as string)
      }
      if (!printed && data.label_url) {
        window.open(data.label_url, '_blank', 'noopener,noreferrer')
      }

      setShipped({
        order_id: data.order_id,
        label_url: data.label_url,
        zpl: data.zpl,
        tracking_number: data.tracking_number,
        carrier: data.carrier,
        cost: data.cost,
        printed,
      })
      setPreview(null)
      setReject(null)
      setPackedToday(c => c + 1)
      setQueueCount(c => (c == null ? c : Math.max(0, c - 1)))

      // Auto-reset back to idle after a short success display so
      // the scanner is ready for the next package without a click.
      setTimeout(() => {
        setShipped(null)
        scanRef.current?.focus()
      }, 2500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setShipping(false)
    }
  }

  function reset() {
    setPreview(null)
    setReject(null)
    setShipped(null)
    setError(null)
    setScan('')
    scanRef.current?.focus()
  }

  // Enter in preview triggers ship. Escape clears preview.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (e.key === 'Enter' && preview && !shipping) {
        e.preventDefault()
        shipNow()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        reset()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, shipping])

  if (!authChecked) {
    return (
      <div className="py-20 text-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  return (
    <div>
      {/* ── Header: queue counter + today's packed + printer status ── */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Pack Out</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Scan a product label to ship.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <PrinterStatusBadge status={printerStatus} />
          <div className="px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-700">
            <span className="font-bold tabular-nums">{queueCount ?? '—'}</span>{' '}
            <span className="text-zinc-500">ready to pack</span>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700">
            <span className="font-bold tabular-nums">{packedToday}</span>{' '}
            <span className="text-emerald-600">packed today</span>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      {!preview && !reject && !shipped && (
        <form onSubmit={handleScanSubmit} className="max-w-2xl">
          <label className="block text-xs uppercase tracking-wide text-zinc-500 font-semibold mb-2">
            Scan Product QR
          </label>
          <input
            ref={scanRef}
            value={scan}
            onChange={e => setScan(e.target.value)}
            disabled={looking}
            autoFocus
            placeholder="Scanner will type here. Or paste an order_item ID."
            className="w-full px-5 py-4 rounded-xl bg-white border-2 border-zinc-200 text-lg font-mono text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-colors"
          />
          {looking && (
            <p className="mt-3 text-sm text-zinc-500">Looking up order…</p>
          )}
          {error && (
            <p className="mt-3 text-sm text-red-600">{error}</p>
          )}
        </form>
      )}

      {reject && <RejectCard reject={reject} onReset={reset} />}

      {preview && (
        <PreviewCard
          order={preview}
          scannedItemId={scannedItemId}
          onShip={shipNow}
          onCancel={reset}
          shipping={shipping}
          error={error}
        />
      )}

      {shipped && <ShippedCard result={shipped} />}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────

function PrinterStatusBadge({ status }: { status: 'ready' | 'offline' | 'error' | 'checking' }) {
  const cls =
    status === 'ready' ? 'bg-emerald-50 text-emerald-700'
      : status === 'checking' ? 'bg-zinc-100 text-zinc-500'
      : 'bg-amber-50 text-amber-700'
  const label =
    status === 'ready' ? 'Printer ready'
      : status === 'checking' ? 'Printer…'
      : 'Printer offline'
  return (
    <div className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${cls}`}>
      <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${
        status === 'ready' ? 'bg-emerald-500'
          : status === 'checking' ? 'bg-zinc-400'
          : 'bg-amber-500'
      }`} />
      {label}
    </div>
  )
}

function RejectCard({ reject, onReset }: { reject: RejectState; onReset: () => void }) {
  const tone: Record<RejectReason, string> = {
    not_found: 'border-red-200 bg-red-50 text-red-900',
    malformed: 'border-red-200 bg-red-50 text-red-900',
    wrong_label: 'border-red-200 bg-red-50 text-red-900',
    not_authenticated: 'border-amber-200 bg-amber-50 text-amber-900',
    exception_review: 'border-amber-200 bg-amber-50 text-amber-900',
    already_shipped: 'border-blue-200 bg-blue-50 text-blue-900',
    missing_phone: 'border-amber-200 bg-amber-50 text-amber-900',
    cancelled: 'border-zinc-200 bg-zinc-50 text-zinc-700',
  }
  const heading: Record<RejectReason, string> = {
    not_found: 'No order found',
    malformed: 'QR scan unreadable',
    wrong_label: 'Wrong label type',
    not_authenticated: 'Not yet authenticated',
    exception_review: 'In exception review',
    already_shipped: 'Already shipped',
    missing_phone: 'Phone number missing',
    cancelled: 'Order cancelled',
  }
  return (
    <div className={`max-w-2xl rounded-xl border-2 p-5 ${tone[reject.reason]}`}>
      <h2 className="text-lg font-bold mb-1">{heading[reject.reason]}</h2>
      {reject.detail && <p className="text-sm mb-3">{reject.detail}</p>}
      {reject.reason === 'already_shipped' && reject.tracking_number && (
        <p className="text-sm mb-3 font-mono">
          {reject.tracking_carrier} {reject.tracking_number}
        </p>
      )}
      <div className="flex items-center gap-2 mt-4">
        {reject.fixup_url && (
          <Link
            href={reject.fixup_url}
            className="px-3 py-1.5 rounded-lg bg-white text-zinc-900 text-sm font-semibold ring-1 ring-zinc-200 hover:ring-zinc-400 transition-colors"
          >
            Open order →
          </Link>
        )}
        {reject.existing_label_url && (
          <a
            href={reject.existing_label_url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 rounded-lg bg-white text-zinc-900 text-sm font-semibold ring-1 ring-zinc-200 hover:ring-zinc-400 transition-colors"
          >
            Reprint label
          </a>
        )}
        <button
          type="button"
          onClick={onReset}
          className="px-3 py-1.5 rounded-lg text-sm font-semibold text-zinc-600 hover:bg-white/50 transition-colors"
        >
          Scan another
        </button>
      </div>
    </div>
  )
}

function PreviewCard({
  order,
  scannedItemId,
  onShip,
  onCancel,
  shipping,
  error,
}: {
  order: PackOrder
  scannedItemId: string | null
  onShip: () => void
  onCancel: () => void
  shipping: boolean
  error: string | null
}) {
  const addr = order.shipping_address
  return (
    <div className="max-w-3xl bg-white border border-zinc-200 rounded-xl overflow-hidden">
      <div className="px-5 py-4 bg-emerald-50 border-b border-emerald-100">
        <p className="text-xs uppercase tracking-wider font-bold text-emerald-700">
          Ready to ship
        </p>
        <p className="text-sm text-emerald-900 mt-0.5">
          Order #{order.id.slice(0, 8)} · {order.item_count} item{order.item_count === 1 ? '' : 's'} · {order.buyer_name}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 p-5">
        {/* Items */}
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-400 font-medium mb-2">
            In this package
          </p>
          <ul className="space-y-2">
            {order.items.map(item => (
              <li
                key={item.id}
                className={`flex items-center gap-3 p-2 rounded-lg ${
                  item.id === scannedItemId ? 'bg-orange-50 ring-1 ring-orange-200' : ''
                }`}
              >
                {item.image_url ? (
                  <Image src={item.image_url} alt="" width={36} height={50} className="w-9 h-12 object-cover rounded flex-shrink-0" unoptimized />
                ) : (
                  <div className="w-9 h-12 rounded bg-zinc-100 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-900 truncate">
                    {item.card_name || 'Unknown card'}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {item.condition} × {item.quantity}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Address */}
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-400 font-medium mb-2">
            Ship to
          </p>
          <div className="text-sm text-zinc-900 space-y-0.5">
            <p className="font-semibold">{addr.name}</p>
            <p className="text-zinc-600">{addr.line1}{addr.line2 ? `, ${addr.line2}` : ''}</p>
            <p className="text-zinc-600">{addr.city}, {addr.state} {addr.zip}</p>
            {addr.phone && (
              <p className="text-zinc-400 text-xs font-mono mt-1">{addr.phone}</p>
            )}
          </div>
          {order.shipping_cost > 0 && (
            <p className="text-xs text-zinc-500 mt-3">
              Buyer paid <span className="font-semibold text-zinc-700">${order.shipping_cost.toFixed(2)}</span> shipping at checkout
            </p>
          )}
        </div>
      </div>

      {error && (
        <div className="mx-5 mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="px-5 py-4 bg-zinc-50 border-t border-zinc-100 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={shipping}
          className="px-3 py-2 rounded-lg text-sm font-medium text-zinc-600 hover:bg-zinc-100 transition-colors disabled:opacity-50"
        >
          Cancel <kbd className="ml-1 text-xs font-mono opacity-60">Esc</kbd>
        </button>
        <button
          type="button"
          onClick={onShip}
          disabled={shipping}
          className="px-6 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm transition-colors disabled:bg-orange-300 disabled:cursor-wait"
        >
          {shipping ? 'Shipping…' : <>Generate + Print Label <kbd className="ml-1 text-xs font-mono opacity-75">↵</kbd></>}
        </button>
      </div>
    </div>
  )
}

function ShippedCard({ result }: { result: ShipResult }) {
  return (
    <div className="max-w-2xl bg-emerald-50 border-2 border-emerald-200 rounded-xl p-6 text-center">
      <div className="w-12 h-12 rounded-full bg-emerald-500 flex items-center justify-center mx-auto mb-3">
        <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-emerald-900">Shipped</h2>
      <p className="text-sm text-emerald-800 mt-1">
        Order #{result.order_id.slice(0, 8)} · {result.carrier} <span className="font-mono">{result.tracking_number}</span>
      </p>
      <p className="text-xs text-emerald-700 mt-2">
        {result.printed ? 'Label sent to printer. Apply and ship.' : (
          <>
            Label generated but auto-print failed.{' '}
            <a href={result.label_url} target="_blank" rel="noopener noreferrer" className="underline font-semibold">
              Open label PDF
            </a>
          </>
        )}
      </p>
      <p className="text-xs text-emerald-600/70 mt-4">
        Resetting for next scan…
      </p>
    </div>
  )
}
