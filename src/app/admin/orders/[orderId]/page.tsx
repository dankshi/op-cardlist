'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { ConditionBadge } from '@/components/marketplace/ConditionBadge'
import { printOrderQrLabels } from '@/lib/zebra'
import { PIPELINE_STEPS } from '@/lib/admin/orderStatus'
import { StatusBadge } from '@/components/admin/ui/StatusBadge'
import { CopyButton } from '@/components/admin/ui/CopyButton'
import { Section, EmptyHint } from '@/components/admin/ui/Section'
import { Field, FieldGrid } from '@/components/admin/ui/Field'
import type { Order, OrderItem, CardCondition } from '@/types/database'

// Non-auth transitions that are still single-button on this page. The auth
// transition (received → authenticated/exception_review) lives on the
// dedicated /admin/authenticate page since it needs per-item decisions.
const ACTIONABLE: Record<string, { nextStatus: string; label: string; tone: string }> = {
  seller_shipped: { nextStatus: 'received', label: 'Mark Received', tone: 'bg-purple-500 hover:bg-purple-600' },
  authenticated: { nextStatus: 'shipped_to_buyer', label: 'Mark Shipped to Buyer', tone: 'bg-indigo-500 hover:bg-indigo-600' },
}

type Rec = Record<string, unknown>

type FullOrder = {
  order: Order & { buyer?: Rec; seller?: Rec }
  items: OrderItem[]
  listings: Rec[]
  intake_issues: Rec[]
  activity_log: Rec[]
  consignments: Rec[]
  buyouts: Rec[]
  reviews: Rec[]
  credit_transactions: Rec[]
}

export default function AdminOrderDetailPage() {
  const params = useParams()
  const orderId = params.orderId as string

  const [data, setData] = useState<FullOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [notes, setNotes] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [labelLoading, setLabelLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cardImages, setCardImages] = useState<Record<string, string>>({})

  async function refetch() {
    const res = await fetch(`/api/admin/orders/${orderId}/full`)
    if (res.status === 403 || res.status === 401) { window.location.href = '/'; return }
    if (res.status === 404) { setNotFound(true); return }
    const json = (await res.json()) as FullOrder
    setData(json)

    // Card thumbnails — only fetch the IDs we need; snapshot_photo_url
    // already covers item photos taken at sale time, so skip those.
    const ids = [...new Set(json.items.filter(i => !i.snapshot_photo_url).map(i => i.card_id))]
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

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await refetch()
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId])

  async function handleStatusChange(nextStatus: string) {
    setError(null)
    setActionLoading(true)
    const res = await fetch(`/api/admin/orders/${orderId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus, notes: notes || undefined }),
    })
    if (res.ok) {
      setNotes('')
      await refetch()
    } else {
      const d = await res.json().catch(() => ({}))
      setError(d.error || 'Failed to update status')
    }
    setActionLoading(false)
  }

  async function handleGenerateOutboundLabel() {
    setError(null)
    setLabelLoading(true)
    const res = await fetch(`/api/admin/orders/${orderId}/outbound-label`, { method: 'POST' })
    if (res.ok) {
      const d = await res.json()
      if (d.label_url) window.open(d.label_url, '_blank', 'noopener,noreferrer')
      await refetch()
    } else {
      const d = await res.json().catch(() => ({}))
      setError(d.error || 'Label generation failed')
    }
    setLabelLoading(false)
  }

  if (loading) {
    return (
      <div className="py-20 text-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  if (notFound || !data) {
    return (
      <div className="py-20 text-center">
        <p className="text-zinc-500">Order not found.</p>
        <Link href="/admin/orders" className="mt-3 inline-block text-indigo-600 hover:text-indigo-700 text-sm font-medium">
          &larr; Back to Orders
        </Link>
      </div>
    )
  }

  const order = data.order
  const items = data.items || []
  const listingsById = new Map(data.listings.map(l => [String(l.id), l]))
  const action = ACTIONABLE[order.status]
  const addr = order.shipping_address

  return (
    <div className="max-w-6xl">
      <Link href="/admin/orders" className="text-sm text-zinc-500 hover:text-zinc-700 mb-4 inline-block">
        &larr; Back to Orders
      </Link>

      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-zinc-900">Order</h1>
            <StatusBadge status={order.status} size="md" />
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="font-mono text-sm text-zinc-600">{order.id}</span>
            <CopyButton value={order.id} />
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Placed {new Date(order.created_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <PipelineStepper currentStatus={order.status} />

      {/* ── Actions ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <button
          type="button"
          onClick={async () => {
            if (items.length === 0) { alert('Order has no items'); return }
            const { method, count } = await printOrderQrLabels(
              order.id,
              items.map(i => ({ id: i.id, card_name: i.card_name || i.card_id, card_id: i.card_id })),
            )
            if (method === 'zpl') alert(`Printed ${count} label${count === 1 ? '' : 's'} to the Zebra.`)
          }}
          className="px-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors cursor-pointer"
          title="Reprint Product QR labels for every item (works on any printer)"
        >
          Print Labels
        </button>

        {order.status === 'seller_shipped' && (
          <Link href={`/admin/intake?orderId=${order.id}`} className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors">
            Go to Intake &rarr;
          </Link>
        )}
        {order.status === 'received' && (
          <Link href={`/admin/authenticate/${order.id}`} className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold transition-colors">
            Start Authentication &rarr;
          </Link>
        )}
        {(order.status === 'received' || order.status === 'exception_review') && (
          <Link href={`/admin/authenticate/${order.id}`} className="px-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors">
            Authenticate Items &rarr;
          </Link>
        )}
        {(order.status === 'authenticated' || order.status === 'shipped_to_buyer') && (
          <button
            onClick={handleGenerateOutboundLabel}
            disabled={labelLoading}
            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors cursor-pointer disabled:opacity-50"
          >
            {labelLoading ? 'Generating…' : order.outbound_label_url ? 'Regenerate Outbound Label' : 'Print Outbound Label'}
          </button>
        )}
        {order.status === 'under_review' && (
          <Link href="/admin/orders?status=under_review" className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors">
            Risk Review &rarr;
          </Link>
        )}
      </div>

      {/* Non-auth status transition with optional notes */}
      {action && (
        <Section title="Next Step" className="mb-6">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Optional notes for this transition (appended to admin notes)"
            rows={2}
            className="w-full px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-200 text-zinc-900 placeholder-zinc-400 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent mb-3"
          />
          <button
            onClick={() => handleStatusChange(action.nextStatus)}
            disabled={actionLoading}
            className={`w-full px-4 py-2 rounded-lg text-white font-semibold text-sm transition-colors cursor-pointer disabled:opacity-50 ${action.tone}`}
          >
            {actionLoading ? 'Processing...' : action.label}
          </button>
        </Section>
      )}

      {order.status === 'exception_review' && (
        <div className="mb-6">
          <ExceptionResolutionPanel order={{ ...order, items }} onResolved={refetch} />
        </div>
      )}

      {/* ── Order record (every column) ───────────────────────────── */}
      <Section title="Order Record" className="mb-6">
        <RawRecordGrid record={order as unknown as Rec} omit={['buyer', 'seller', 'items', 'shipping_address']} />
      </Section>

      {/* ── Parties + shipping ────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <PartyCard label="Buyer" profile={order.buyer} />
        <PartyCard label="Seller" profile={order.seller} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Section title="Ship To" bodyClassName="p-4">
          {addr ? (
            <div className="text-sm text-zinc-700 space-y-0.5">
              <p className="font-medium text-zinc-900">{addr.name}</p>
              <p>{addr.line1}{addr.line2 ? `, ${addr.line2}` : ''}</p>
              <p>{addr.city}, {addr.state} {addr.zip} {addr.country}</p>
            </div>
          ) : (
            <EmptyHint>No shipping address on file.</EmptyHint>
          )}
        </Section>
        <ShippingLegCard
          title="Inbound — Seller → Platform"
          tracking={order.seller_tracking_number}
          carrier={order.seller_tracking_carrier}
          labelUrl={order.seller_label_url}
          cost={order.seller_label_cost}
          shippedAt={order.shipped_at}
          emptyHint="Seller hasn't generated a label yet."
        />
        <ShippingLegCard
          title="Outbound — Platform → Buyer"
          tracking={order.tracking_number}
          carrier={order.tracking_carrier}
          labelUrl={order.outbound_label_url}
          cost={order.outbound_label_cost}
          shippedAt={order.shipped_to_buyer_at}
          emptyHint="No outbound label generated yet."
        />
      </div>

      {/* ── Items (every column per item) ─────────────────────────── */}
      <Section title="Items" count={items.length} className="mb-6" bodyClassName="p-0">
        <div className="divide-y divide-zinc-100">
          {items.length === 0 && <div className="p-4"><EmptyHint>No items.</EmptyHint></div>}
          {items.map(item => (
            <ItemBlock
              key={item.id}
              item={item}
              img={item.snapshot_photo_url || cardImages[item.card_id]}
              listing={listingsById.get(String(item.listing_id))}
              consignment={data.consignments.find(c => c.order_item_id === item.id)}
              buyout={data.buyouts.find(b => b.order_item_id === item.id)}
            />
          ))}
        </div>
      </Section>

      {/* ── Related records ───────────────────────────────────────── */}
      <RelatedRecords title="Intake Issues" rows={data.intake_issues} />
      <RelatedRecords title="Activity Log" rows={data.activity_log} />
      <RelatedRecords title="Consignments" rows={data.consignments} />
      <RelatedRecords title="Buyouts" rows={data.buyouts} />
      <RelatedRecords title="Reviews" rows={data.reviews} />
      <RelatedRecords title="Credit Transactions" rows={data.credit_transactions} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Generic field rendering — keeps the master view exhaustive and
// resilient to schema changes (new columns show up automatically).
// ─────────────────────────────────────────────────────────────────

const MONEY_RE = /(amount|price|total|subtotal|cost|fee|balance|gmv|recovered|debited)/i

function kindFor(key: string, value: unknown): 'id' | 'datetime' | 'money' | 'bool' | 'json' | 'text' {
  if (typeof value === 'boolean') return 'bool'
  if (value !== null && typeof value === 'object') return 'json'
  if (key === 'id' || key.endsWith('_id')) return 'id'
  if (key.endsWith('_at')) return 'datetime'
  if (MONEY_RE.test(key)) return 'money'
  return 'text'
}

function humanizeKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

/** Dumps every column of a record as Fields, inferring the display kind
 *  from the key/value. `omit` drops joined sub-objects or fields rendered
 *  elsewhere. */
function RawRecordGrid({ record, omit = [], cols = 3 }: { record: Rec; omit?: string[]; cols?: 2 | 3 | 4 }) {
  const entries = Object.entries(record).filter(([k]) => !omit.includes(k))
  return (
    <FieldGrid cols={cols}>
      {entries.map(([k, v]) => (
        <Field key={k} label={humanizeKey(k)} value={v} kind={kindFor(k, v)} />
      ))}
    </FieldGrid>
  )
}

function PartyCard({ label, profile }: { label: string; profile?: Rec }) {
  return (
    <Section title={label}>
      {profile ? (
        <RawRecordGrid record={profile} cols={3} />
      ) : (
        <EmptyHint>Unknown {label.toLowerCase()}.</EmptyHint>
      )}
    </Section>
  )
}

function ShippingLegCard({
  title, tracking, carrier, labelUrl, cost, shippedAt, emptyHint,
}: {
  title: string
  tracking: string | null
  carrier: string | null
  labelUrl: string | null
  cost: number | null
  shippedAt: string | null
  emptyHint: string
}) {
  return (
    <Section title={title}>
      {tracking ? (
        <div className="space-y-1.5 text-sm">
          <p className="text-zinc-900">
            {carrier && <span className="text-zinc-500">{carrier}: </span>}
            <span className="font-mono">{tracking}</span>
            <CopyButton value={tracking} className="ml-1 align-middle" />
          </p>
          {shippedAt && <p className="text-xs text-zinc-500">Shipped {new Date(shippedAt).toLocaleDateString()}</p>}
          {cost != null && <p className="text-xs text-zinc-500">Label cost: ${Number(cost).toFixed(2)}</p>}
          {labelUrl && (
            <a href={labelUrl} target="_blank" rel="noopener noreferrer" className="inline-block mt-1 text-sm font-medium text-indigo-600 hover:text-indigo-700">
              Download Label PDF &rarr;
            </a>
          )}
        </div>
      ) : (
        <EmptyHint>{emptyHint}</EmptyHint>
      )}
    </Section>
  )
}

function ItemBlock({
  item, img, listing, consignment, buyout,
}: {
  item: OrderItem
  img?: string
  listing?: Rec
  consignment?: Rec
  buyout?: Rec
}) {
  return (
    <div className="p-4">
      <div className="flex gap-3">
        {img ? (
          <Image src={img} alt="" width={56} height={80} className="w-14 h-20 object-cover rounded flex-shrink-0" unoptimized />
        ) : (
          <div className="w-14 h-20 rounded bg-zinc-100 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/card/${item.card_id.toLowerCase()}`} className="font-medium text-zinc-900 hover:text-indigo-600 transition-colors">
              {item.card_name || item.card_id}
            </Link>
            <ConditionBadge condition={item.condition as CardCondition} />
            <span className="text-xs text-zinc-500">x{item.quantity}</span>
            <span className="ml-auto font-medium text-zinc-900">${(Number(item.unit_price) * item.quantity).toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-1 text-xs">
            <span className="text-zinc-400">item id</span>
            <span className="font-mono text-zinc-600">{item.id}</span>
            <CopyButton value={item.id} />
          </div>
        </div>
      </div>

      <div className="mt-3 pl-0 sm:pl-[68px]">
        <RawRecordGrid record={item as unknown as Rec} cols={3} />

        {listing && (
          <details className="mt-3 group">
            <summary className="text-xs uppercase tracking-wide text-zinc-400 font-medium cursor-pointer hover:text-zinc-600">
              Listing snapshot
            </summary>
            <div className="mt-2 rounded-lg bg-zinc-50 border border-zinc-100 p-3">
              <RawRecordGrid record={listing} cols={3} />
            </div>
          </details>
        )}
        {consignment && (
          <details className="mt-3">
            <summary className="text-xs uppercase tracking-wide text-amber-600 font-medium cursor-pointer hover:text-amber-700">
              Consignment record
            </summary>
            <div className="mt-2 rounded-lg bg-amber-50 border border-amber-100 p-3">
              <RawRecordGrid record={consignment} cols={3} />
            </div>
          </details>
        )}
        {buyout && (
          <details className="mt-3">
            <summary className="text-xs uppercase tracking-wide text-rose-600 font-medium cursor-pointer hover:text-rose-700">
              Buyout record
            </summary>
            <div className="mt-2 rounded-lg bg-rose-50 border border-rose-100 p-3">
              <RawRecordGrid record={buyout} cols={3} />
            </div>
          </details>
        )}
      </div>
    </div>
  )
}

function RelatedRecords({ title, rows }: { title: string; rows: Rec[] }) {
  return (
    <Section title={title} count={rows.length} className="mb-6" bodyClassName="p-0">
      {rows.length === 0 ? (
        <div className="p-4"><EmptyHint>None.</EmptyHint></div>
      ) : (
        <div className="divide-y divide-zinc-100">
          {rows.map((row, i) => (
            <div key={(row.id as string) || i} className="p-4">
              <RawRecordGrid record={row} cols={4} />
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

function PipelineStepper({ currentStatus }: { currentStatus: string }) {
  // exception_review is a side-branch of received (package in our hands
  // but stuck in resolution). Show the stepper at "received" so the rest
  // of the pipeline still reads as upcoming, and append an amber badge.
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
                    isComplete ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-400'
                  } ${isCurrent ? 'ring-2 ring-indigo-600 ring-offset-2' : ''}`}
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
                <div className={`flex-1 h-0.5 mx-2 mt-[-16px] ${i < currentIndex ? 'bg-indigo-600' : 'bg-zinc-200'}`} />
              )}
            </div>
          )
        })}
      </div>
      {isException && (
        <div className="mt-3 pt-3 border-t border-zinc-100 flex items-center gap-2 text-xs">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
          <span className="text-amber-700 font-medium">Branched to Exception Review</span>
          <span className="text-zinc-400">— resolve from the panel above</span>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// ExceptionResolutionPanel — renders only when status='exception_review'.
// Surfaces every flagged item with the right per-disposition input and a
// single button to refund the buyer + cancel the order.
// POST /api/admin/orders/[id]/resolve-exception.
// ─────────────────────────────────────────────────────────────────

function ExceptionResolutionPanel({ order, onResolved }: { order: Order; onResolved: () => void }) {
  const items = (order.items || []).filter(
    i => (i.exception_types && i.exception_types.length > 0) || i.auth_decision === 'fake',
  )
  const [consignmentPrices, setConsignmentPrices] = useState<Record<string, string>>({})
  const [claimIds, setClaimIds] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refundAmount = Number(order.total || 0)

  async function submit() {
    if (!confirm(`Refund $${refundAmount.toFixed(2)} to the buyer's wallet and cancel this order? This can't be undone.`)) return
    setSubmitting(true)
    setError(null)
    try {
      const priceMap: Record<string, number> = {}
      for (const [k, v] of Object.entries(consignmentPrices)) {
        const n = Number.parseFloat(v)
        if (Number.isFinite(n) && n >= 0) priceMap[k] = n
      }
      const claimMap: Record<string, string> = {}
      for (const [k, v] of Object.entries(claimIds)) {
        if (v.trim()) claimMap[k] = v.trim()
      }
      const res = await fetch(`/api/admin/orders/${order.id}/resolve-exception`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consignment_prices: priceMap, carrier_claim_ids: claimMap, notes: notes.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to resolve'); return }
      onResolved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-white border-2 border-amber-300 rounded-lg overflow-hidden">
      <div className="px-4 py-3 bg-amber-50 border-b border-amber-200">
        <p className="text-xs uppercase tracking-wide font-bold text-amber-800">Exception resolution</p>
        <p className="text-sm text-amber-900 mt-0.5">Set per-item dispositions below, then refund the buyer to close out the order.</p>
      </div>
      <div className="p-4 space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-zinc-500">No flagged items found. The order may have reached exception_review by an older flow.</p>
        ) : (
          items.map(item => (
            <ResolutionItemRow
              key={item.id}
              item={item}
              consignmentPrice={consignmentPrices[item.id] ?? ''}
              claimId={claimIds[item.id] ?? ''}
              onConsignmentPriceChange={v => setConsignmentPrices(p => ({ ...p, [item.id]: v }))}
              onClaimIdChange={v => setClaimIds(p => ({ ...p, [item.id]: v }))}
            />
          ))
        )}
      </div>
      <div className="px-4 pb-4">
        <label className="block text-xs uppercase tracking-wide text-zinc-400 font-medium mb-1.5">Resolution notes (optional)</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Any additional context — appended to admin notes."
          rows={2}
          className="w-full px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
      {error && (
        <div className="mx-4 mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
      )}
      <div className="px-4 py-3 bg-zinc-50 border-t border-zinc-100 flex items-center justify-between gap-3">
        <div className="text-sm text-zinc-600">
          Buyer refund: <span className="font-bold text-zinc-900 tabular-nums">${refundAmount.toFixed(2)}</span>{' '}
          <span className="text-zinc-400">to wallet</span>
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={submitting || items.length === 0}
          className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm transition-colors disabled:bg-emerald-300 disabled:cursor-not-allowed"
        >
          {submitting ? 'Resolving…' : 'Refund + Cancel Order'}
        </button>
      </div>
    </div>
  )
}

function ResolutionItemRow({
  item, consignmentPrice, claimId, onConsignmentPriceChange, onClaimIdChange,
}: {
  item: OrderItem
  consignmentPrice: string
  claimId: string
  onConsignmentPriceChange: (v: string) => void
  onClaimIdChange: (v: string) => void
}) {
  const exTypes = item.exception_types || []
  const exDetails = (item.exception_details || {}) as Record<string, unknown>
  const isFake = item.auth_decision === 'fake'

  const consigned = exTypes.some(t => {
    if (t === 'incorrect_product' || t === 'conditional') return true
    if (t === 'physical_damage') {
      const d = exDetails[t] as { attribution?: string } | undefined
      return d?.attribution === 'seller'
    }
    return false
  })
  const courierDamage = exTypes.includes('physical_damage') && (
    (exDetails['physical_damage'] as { attribution?: string } | undefined)?.attribution === 'courier'
  )
  const nomiDamage = exTypes.includes('physical_damage') && (
    (exDetails['physical_damage'] as { attribution?: string } | undefined)?.attribution === 'nomi'
  )

  return (
    <div className="border border-zinc-200 rounded-lg p-3">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <span className="font-medium text-zinc-900">{item.card_name || item.card_id}</span>
        {isFake && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-800">
            Fake — {(exDetails['fake'] as { disposition?: string } | undefined)?.disposition === 'return_to_seller' ? 'return' : 'destroy'}
          </span>
        )}
        {exTypes.map(t => (
          <span key={t} className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800">
            {t.replace('_', ' ')}
          </span>
        ))}
      </div>

      {consigned && (
        <div className="mb-2">
          <label className="block text-xs text-zinc-500 font-medium mb-1">Consignment relist price</label>
          <div className="flex items-center">
            <span className="px-3 py-1.5 rounded-l-lg bg-zinc-100 text-zinc-500 text-sm border border-r-0 border-zinc-200">$</span>
            <input
              type="number" step="0.01" min="0" value={consignmentPrice}
              onChange={e => onConsignmentPriceChange(e.target.value)} placeholder="0.00"
              className="flex-1 px-3 py-1.5 rounded-r-lg border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <p className="text-[11px] text-zinc-400 mt-1">Optional — leaves the consigned item ready for ops to list. Can be set later.</p>
        </div>
      )}

      {courierDamage && (
        <div className="mb-2">
          <label className="block text-xs text-zinc-500 font-medium mb-1">Carrier claim ID</label>
          <input
            type="text" value={claimId} onChange={e => onClaimIdChange(e.target.value)}
            placeholder="e.g. Shippo claim ref or USPS case #"
            className="w-full px-3 py-1.5 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <p className="text-[11px] text-zinc-400 mt-1">Optional — files the claim against the existing buyout row. Seller is already credited.</p>
        </div>
      )}

      {nomiDamage && (
        <p className="text-xs text-zinc-500">Seller has already been bought out at the sale price. No further action needed beyond cancelling the order.</p>
      )}

      {isFake && (
        <p className="text-xs text-zinc-500">
          {(exDetails['fake'] as { disposition?: string } | undefined)?.disposition === 'return_to_seller'
            ? 'Ship the card back to the seller and record tracking on their notification.'
            : 'Confirm the card has been destroyed (photo certification recommended).'}
        </p>
      )}
    </div>
  )
}
