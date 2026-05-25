'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { ConditionBadge } from '@/components/marketplace/ConditionBadge'
import { printProductLabel } from '@/lib/zebra'
import type { Order, OrderItem, CardCondition } from '@/types/database'

const STATUS_STYLES: Record<string, string> = {
  pending_payment: 'bg-zinc-200 text-zinc-600',
  under_review: 'bg-amber-500/10 text-amber-600',
  paid: 'bg-yellow-500/10 text-yellow-600',
  seller_shipped: 'bg-blue-500/10 text-blue-600',
  received: 'bg-purple-500/10 text-purple-600',
  exception_review: 'bg-amber-500/15 text-amber-700',
  authenticated: 'bg-emerald-500/10 text-emerald-600',
  shipped_to_buyer: 'bg-indigo-500/10 text-indigo-600',
  delivered: 'bg-green-500/10 text-green-600',
  cancelled: 'bg-red-500/10 text-red-600',
  refunded: 'bg-zinc-200 text-zinc-500',
  disputed: 'bg-rose-500/10 text-rose-600',
}

const STATUS_LABELS: Record<string, string> = {
  pending_payment: 'Pending Payment',
  under_review: 'Under Review',
  paid: 'Paid — Awaiting Ship',
  seller_shipped: 'Seller Shipped',
  received: 'Received — Awaiting Authentication',
  exception_review: 'Exception Review',
  authenticated: 'Authenticated',
  shipped_to_buyer: 'Shipped to Buyer',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  disputed: 'Disputed',
}

// Same forward pipeline used on /admin and /orders/[id]. Defined here so the
// admin detail page can show what step we're on without depending on the
// buyer-facing component, which has different visuals.
const PIPELINE_STEPS = [
  { key: 'paid', label: 'Paid' },
  { key: 'seller_shipped', label: 'Seller Shipped' },
  { key: 'received', label: 'Received' },
  { key: 'authenticated', label: 'Authenticated' },
  { key: 'shipped_to_buyer', label: 'Shipped to Buyer' },
  { key: 'delivered', label: 'Delivered' },
]

// Non-auth transitions that are still single-button on this page. The
// auth transition (received → authenticated/exception_review) was moved
// out to the dedicated /admin/authenticate page since it needs per-item
// decisions; rendering its CTA here would be misleading.
const ACTIONABLE: Record<string, { nextStatus: string; label: string; tone: string }> = {
  seller_shipped: { nextStatus: 'received', label: 'Mark Received', tone: 'bg-purple-500 hover:bg-purple-600' },
  authenticated: { nextStatus: 'shipped_to_buyer', label: 'Mark Shipped to Buyer', tone: 'bg-indigo-500 hover:bg-indigo-600' },
}

type BuyerProfile = { display_name: string; username: string; avatar_url: string | null }

export default function AdminOrderDetailPage() {
  const params = useParams()
  const router = useRouter()
  const orderId = params.orderId as string
  const supabase = useMemo(() => createClient(), [])

  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [notes, setNotes] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [labelLoading, setLabelLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cardImages, setCardImages] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth/sign-in'); return }

      const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single()
      if (!profile?.is_admin) { router.push('/'); return }
      if (cancelled) return
      setAuthorized(true)

      await refetch()
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, router, orderId])

  async function refetch() {
    const [orderRes, itemsRes] = await Promise.all([
      supabase
        .from('orders')
        .select('*, buyer:profiles!orders_buyer_id_fkey(display_name, username, avatar_url), seller:profiles!orders_seller_id_fkey(display_name, username, avatar_url)')
        .eq('id', orderId)
        .single(),
      supabase
        .from('order_items')
        .select('*')
        .eq('order_id', orderId),
    ])

    const orderData = orderRes.data
    const items = (itemsRes.data || []) as OrderItem[]
    if (!orderData) return
    setOrder({ ...orderData, items } as Order)

    // Card thumbnails — only fetch the IDs we need. snapshot_photo_url
    // already covers item photos taken at sale time, so skip those.
    const ids = [...new Set(items.filter(i => !i.snapshot_photo_url).map(i => i.card_id))]
    if (ids.length > 0) {
      try {
        const r = await fetch(`/api/cards?basic=1&ids=${encodeURIComponent(ids.join(','))}`)
        const d = await r.json()
        const imgs: Record<string, string> = {}
        for (const c of d.cards || []) {
          if (c.imageUrl) imgs[c.id] = c.imageUrl
        }
        setCardImages(imgs)
      } catch { /* swallow — thumbnails are decorative */ }
    }
  }

  async function handleStatusChange(nextStatus: string) {
    if (!order) return
    setError(null)
    setActionLoading(true)
    const res = await fetch(`/api/admin/orders/${order.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus, notes: notes || undefined }),
    })
    if (res.ok) {
      setNotes('')
      await refetch()
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Failed to update status')
    }
    setActionLoading(false)
  }

  async function handleGenerateOutboundLabel() {
    if (!order) return
    setError(null)
    setLabelLoading(true)
    const res = await fetch(`/api/admin/orders/${order.id}/outbound-label`, { method: 'POST' })
    if (res.ok) {
      const data = await res.json()
      if (data.label_url) window.open(data.label_url, '_blank', 'noopener,noreferrer')
      await refetch()
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Label generation failed')
    }
    setLabelLoading(false)
  }

  if (loading || !authorized) {
    return (
      <div className="py-20 text-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  if (!order) {
    return (
      <div className="py-20 text-center">
        <p className="text-zinc-500">Order not found.</p>
        <Link href="/admin/orders" className="mt-3 inline-block text-orange-500 hover:text-orange-600 text-sm font-medium">
          &larr; Back to Orders
        </Link>
      </div>
    )
  }

  const action = ACTIONABLE[order.status]
  const buyer = order.buyer as BuyerProfile | undefined
  const seller = order.seller as BuyerProfile | undefined
  const addr = order.shipping_address

  return (
    <div className="max-w-4xl">
      <Link href="/admin/orders" className="text-sm text-zinc-500 hover:text-zinc-700 mb-4 inline-block">
        &larr; Back to Orders
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900">Order #{order.id.slice(0, 8)}</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Placed {new Date(order.created_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
          </p>
        </div>
        <span className={`text-sm px-3 py-1 rounded-full font-medium ${STATUS_STYLES[order.status] || ''}`}>
          {STATUS_LABELS[order.status] || order.status}
        </span>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <PipelineStepper currentStatus={order.status} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <PartyCard label="Buyer" profile={buyer} sub={buyer?.username ? `@${buyer.username}` : ''} />
        <PartyCard label="Seller" profile={seller} sub={seller?.username ? `@${seller.username}` : ''} />
        <div className="bg-white border border-zinc-200 rounded-lg p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-400 font-medium mb-2">Totals</p>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-zinc-500">
              <span>Subtotal</span><span>${Number(order.subtotal).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-zinc-500">
              <span>Shipping</span><span>${Number(order.shipping_cost).toFixed(2)}</span>
            </div>
            {Number(order.credits_applied) > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Credits</span><span>-${Number(order.credits_applied).toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-zinc-900 font-bold pt-1 border-t border-zinc-100">
              <span>Total</span><span>${Number(order.total).toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Items + intake status */}
      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-zinc-200 flex items-center justify-between">
          <h2 className="font-medium text-zinc-900">Items ({order.items?.length || 0})</h2>
          {/* Per-status item-level action link. Intake (receive + scan)
              is the seller-shipped step; Authentication (per-item
              decision) is the received / exception_review step. */}
          {order.status === 'seller_shipped' && (
            <Link
              href={`/admin/intake?orderId=${order.id}`}
              className="text-sm font-medium text-orange-500 hover:text-orange-600"
            >
              Go to Intake &rarr;
            </Link>
          )}
          {(order.status === 'received' || order.status === 'exception_review') && (
            <Link
              href={`/admin/authenticate/${order.id}`}
              className="text-sm font-medium text-orange-500 hover:text-orange-600"
            >
              Authenticate Items &rarr;
            </Link>
          )}
          {/* Always-available reprint of Product QR labels. Useful
              when intake's print failed mid-batch, a sticker got
              damaged, or during dev/testing the pack flow without
              going through the full receive step. */}
          <button
            type="button"
            onClick={async () => {
              const items = order.items || []
              if (items.length === 0) {
                alert('Order has no items')
                return
              }
              const shortId = order.id.slice(0, 8).toUpperCase()
              let printed = 0
              let failed = 0
              for (const item of items) {
                const r = await printProductLabel(
                  item.id,
                  item.card_name || item.card_id,
                  shortId,
                )
                if (r.success) printed++
                else failed++
              }
              alert(`Printed ${printed} label${printed === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}.`)
            }}
            className="text-sm font-medium text-zinc-500 hover:text-zinc-700"
            title="Reprint Product QR labels for every item — useful for testing pack flow"
          >
            Print Labels
          </button>
        </div>
        <div className="divide-y divide-zinc-100">
          {order.items?.map(item => {
            const status = (item as OrderItem).intake_status
            const dotClass =
              status === 'verified' ? 'bg-green-500' :
              status === 'flagged' ? 'bg-red-500' :
              status === 'resolved' ? 'bg-blue-500' :
              status === 'rejected' ? 'bg-rose-500' :
              'bg-zinc-300'
            const img = item.snapshot_photo_url || cardImages[item.card_id]
            return (
              <div key={item.id} className="flex items-center gap-3 p-4">
                {img ? (
                  <Image src={img} alt="" width={56} height={80} className="w-14 h-20 object-cover rounded flex-shrink-0" unoptimized />
                ) : (
                  <div className="w-14 h-20 rounded bg-zinc-100 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/card/${item.card_id.toLowerCase()}`}
                    className="font-medium text-zinc-900 hover:text-orange-500 transition-colors"
                  >
                    {item.card_name || item.card_id}
                  </Link>
                  <div className="flex items-center gap-2 mt-1">
                    <ConditionBadge condition={item.condition as CardCondition} />
                    <span className="text-xs text-zinc-500">x{item.quantity}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5 text-xs text-zinc-500">
                    <span className={`w-2 h-2 rounded-full inline-block ${dotClass}`} />
                    <span>Intake: {status || 'pending'}</span>
                  </div>
                </div>
                <p className="text-zinc-900 font-medium flex-shrink-0">
                  ${(Number(item.unit_price) * item.quantity).toFixed(2)}
                </p>
              </div>
            )
          })}
        </div>
      </div>

      {/* Shipping address */}
      {addr && (
        <div className="bg-white border border-zinc-200 rounded-lg p-4 mb-6">
          <p className="text-xs uppercase tracking-wide text-zinc-400 font-medium mb-2">Ship To</p>
          <p className="text-sm text-zinc-900 font-medium">{addr.name}</p>
          <p className="text-sm text-zinc-600">{addr.line1}{addr.line2 ? `, ${addr.line2}` : ''}</p>
          <p className="text-sm text-zinc-600">{addr.city}, {addr.state} {addr.zip} {addr.country}</p>
        </div>
      )}

      {/* Shipping legs — inbound (seller → platform) + outbound (platform → buyer) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <ShippingLegCard
          title="Inbound — Seller to Platform"
          tracking={order.seller_tracking_number}
          carrier={order.seller_tracking_carrier}
          labelUrl={order.seller_label_url}
          shippedAt={order.shipped_at}
          emptyHint="Seller hasn't generated a label yet."
        />
        <ShippingLegCard
          title="Outbound — Platform to Buyer"
          tracking={order.tracking_number}
          carrier={order.tracking_carrier}
          labelUrl={order.outbound_label_url}
          shippedAt={order.shipped_to_buyer_at}
          emptyHint="No outbound label generated yet."
          action={
            order.status === 'authenticated' || order.status === 'shipped_to_buyer' ? (
              <button
                onClick={handleGenerateOutboundLabel}
                disabled={labelLoading}
                className="mt-3 px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition-colors cursor-pointer disabled:opacity-50"
              >
                {labelLoading
                  ? 'Generating...'
                  : order.outbound_label_url
                    ? 'Regenerate Label'
                    : 'Print Outbound Label'}
              </button>
            ) : null
          }
        />
      </div>

      {/* Admin notes — readonly history */}
      {order.admin_notes && (
        <div className="bg-white border border-zinc-200 rounded-lg p-4 mb-6">
          <p className="text-xs uppercase tracking-wide text-zinc-400 font-medium mb-2">Admin Notes</p>
          <pre className="text-sm text-zinc-700 whitespace-pre-wrap font-sans">{order.admin_notes}</pre>
        </div>
      )}

      {/* Authentication CTA — for `received` (fresh package needs
          per-item decisions) and `exception_review` (admin needs to
          re-decide or re-finalize after a flagged item). The new
          /admin/authenticate page handles the per-item flow and
          calls finalize-auth to set the order's next status. The
          inline "Mark Authenticated" button used to bypass the
          per-item flow and routinely failed the verify-gate. */}
      {(order.status === 'received' || order.status === 'exception_review') && (
        <div className="bg-white border border-zinc-200 rounded-lg p-4 mb-6">
          <p className="text-xs uppercase tracking-wide text-zinc-400 font-medium mb-3">
            {order.status === 'received' ? 'Next Step' : 'Resolution'}
          </p>
          <p className="text-sm text-zinc-600 mb-3">
            {order.status === 'received'
              ? 'Open the authentication workspace to decide each item (Authentic / Fake → Near Mint / Exception) and finalize.'
              : 'This order has at least one flagged item. Reopen the authentication workspace to update decisions and re-finalize.'}
          </p>
          <Link
            href={`/admin/authenticate/${order.id}`}
            className="block text-center w-full px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors"
          >
            {order.status === 'received' ? 'Start Authentication →' : 'Reopen Authentication →'}
          </Link>
        </div>
      )}

      {/* Status transition controls — for non-auth transitions
          (seller_shipped → received, authenticated → shipped_to_buyer).
          The auth transition (received → authenticated/exception_review)
          is now handled by the dedicated auth page above. */}
      {action && order.status !== 'received' && order.status !== 'exception_review' && (
        <div className="bg-white border border-zinc-200 rounded-lg p-4 mb-6">
          <p className="text-xs uppercase tracking-wide text-zinc-400 font-medium mb-3">Next Step</p>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Optional notes for this transition (appended to admin notes)"
            rows={2}
            className="w-full px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-200 text-zinc-900 placeholder-zinc-400 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent mb-3"
          />
          <button
            onClick={() => handleStatusChange(action.nextStatus)}
            disabled={actionLoading}
            className={`w-full px-4 py-2 rounded-lg text-white font-semibold text-sm transition-colors cursor-pointer disabled:opacity-50 ${action.tone}`}
          >
            {actionLoading ? 'Processing...' : action.label}
          </button>
        </div>
      )}

      {/* Risk shortcut for under_review */}
      {order.status === 'under_review' && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-amber-900 mb-3">
            This order is under fraud review. Resolve from the risk inbox.
          </p>
          <Link
            href="/admin/risk"
            className="inline-block px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-semibold text-sm transition-colors"
          >
            Open Risk Review &rarr;
          </Link>
        </div>
      )}
    </div>
  )
}

function PartyCard({ label, profile, sub }: { label: string; profile: BuyerProfile | undefined; sub: string }) {
  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-4">
      <p className="text-xs uppercase tracking-wide text-zinc-400 font-medium mb-2">{label}</p>
      {profile ? (
        <div className="flex items-center gap-2.5">
          {profile.avatar_url ? (
            <Image src={profile.avatar_url} alt="" width={32} height={32} className="w-8 h-8 rounded-full object-cover" unoptimized />
          ) : (
            <div className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-400 text-sm font-medium">
              {profile.display_name?.[0] || '?'}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-900 truncate">{profile.display_name}</p>
            {sub && <p className="text-xs text-zinc-500 truncate">{sub}</p>}
          </div>
        </div>
      ) : (
        <p className="text-sm text-zinc-400">Unknown</p>
      )}
    </div>
  )
}

function ShippingLegCard({
  title, tracking, carrier, labelUrl, shippedAt, emptyHint, action,
}: {
  title: string
  tracking: string | null
  carrier: string | null
  labelUrl: string | null
  shippedAt: string | null
  emptyHint: string
  action?: React.ReactNode
}) {
  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-4">
      <p className="text-xs uppercase tracking-wide text-zinc-400 font-medium mb-2">{title}</p>
      {tracking ? (
        <div className="space-y-1.5">
          <p className="text-sm text-zinc-900">
            {carrier && <span className="text-zinc-500">{carrier}: </span>}
            <span className="font-mono">{tracking}</span>
          </p>
          {shippedAt && (
            <p className="text-xs text-zinc-500">Shipped {new Date(shippedAt).toLocaleDateString()}</p>
          )}
          {labelUrl && (
            <a
              href={labelUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-1 text-sm font-medium text-orange-500 hover:text-orange-600"
            >
              Download Label PDF &rarr;
            </a>
          )}
        </div>
      ) : (
        <p className="text-sm text-zinc-400">{emptyHint}</p>
      )}
      {action}
    </div>
  )
}

function PipelineStepper({ currentStatus }: { currentStatus: string }) {
  // exception_review is a side-branch of received (the package is in
  // our hands but stuck in resolution). Show the stepper at "received"
  // so the rest of the pipeline still reads as upcoming, and append a
  // small amber badge below to flag the branch.
  const effectiveStatus = currentStatus === 'exception_review' ? 'received' : currentStatus
  const currentIndex = PIPELINE_STEPS.findIndex(s => s.key === effectiveStatus)
  const isException = currentStatus === 'exception_review'
  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between">
        {PIPELINE_STEPS.map((step, i) => {
          const isComplete = i <= currentIndex
          const isCurrent = i === currentIndex
          return (
            <div key={step.key} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                    isComplete ? 'bg-orange-500 text-white' : 'bg-zinc-100 text-zinc-400'
                  } ${isCurrent ? 'ring-2 ring-orange-500 ring-offset-2' : ''}`}
                >
                  {isComplete && i < currentIndex ? (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </div>
                <span className={`text-xs mt-1 text-center ${isComplete ? 'text-zinc-900 font-medium' : 'text-zinc-400'}`}>
                  {step.label}
                </span>
              </div>
              {i < PIPELINE_STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-2 mt-[-16px] ${i < currentIndex ? 'bg-orange-500' : 'bg-zinc-200'}`} />
              )}
            </div>
          )
        })}
      </div>
      {isException && (
        <div className="mt-3 pt-3 border-t border-zinc-100 flex items-center gap-2 text-xs">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
          <span className="text-amber-700 font-medium">Branched to Exception Review</span>
          <span className="text-zinc-400">— resolve from the authentication workspace</span>
        </div>
      )}
    </div>
  )
}
