'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// ─────────────────────────────────────────────────────────────────
// Post-exception inventory management.
//
// Two tabs:
//   - Consignment: exception-origin consignment_items (cards consigned
//     on the seller's behalf after an order exception — still the
//     seller's property, sold by Nomi for a commission). Lets ops
//     set/update the relist (ask) price and advance the lifecycle
//     (confirmed → listed → sold | rejected).
//   - Buyouts: buyouts rows (Nomi-funded seller payouts for courier/
//     Nomi-attributable damage). Lets ops record the carrier claim
//     reference, advance the claim status, and log recovered amounts.
//
// Both surfaces are pending-first ordered so the work that needs
// attention surfaces immediately. Inline editing without modals;
// optimistic UI updates so the operator's loop stays tight.
// ─────────────────────────────────────────────────────────────────

interface OrderItemRef {
  id: string
  card_id: string
  card_name: string | null
  condition: string
  quantity?: number
  unit_price?: number
  order_id: string
}

interface PartyRef {
  id: string
  display_name: string | null
  username: string | null
}

interface ConsignmentRow {
  id: string
  exception_type: string
  ask_price: number | null
  listing_id: string | null
  status: 'confirmed' | 'listed' | 'sold' | 'rejected'
  notes: string | null
  created_at: string
  listed_at: string | null
  resolved_at: string | null
  order_item: OrderItemRef | OrderItemRef[] | null
  seller: PartyRef | PartyRef[] | null
}

interface BuyoutRow {
  id: string
  amount: number | string
  reason: string
  carrier_claim_id: string | null
  carrier_claim_status: 'pending' | 'filed' | 'paid' | 'denied' | null
  recovered_amount: number | string
  notes: string | null
  created_at: string
  recovered_at: string | null
  order_item: OrderItemRef | OrderItemRef[] | null
  seller: PartyRef | PartyRef[] | null
}

type Tab = 'consignment' | 'buyouts'

function unwrap<T>(x: T | T[] | null): T | null {
  if (!x) return null
  return Array.isArray(x) ? x[0] ?? null : x
}

export default function AdminInventoryPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = useMemo(() => createClient(), [])
  const initialTab = (searchParams.get('tab') === 'buyouts' ? 'buyouts' : 'consignment') as Tab
  const [tab, setTab] = useState<Tab>(initialTab)
  const [authChecked, setAuthChecked] = useState(false)
  const [consignment, setConsignment] = useState<ConsignmentRow[]>([])
  const [buyouts, setBuyouts] = useState<BuyoutRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const didLoad = useRef(false)

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

        // Fetch both tabs upfront — the lists are small (200 max each)
        // and ops typically flips between tabs in the same session.
        const [cRes, bRes] = await Promise.all([
          fetch('/api/admin/inventory/consignment'),
          fetch('/api/admin/inventory/buyouts'),
        ])
        const cData = await cRes.json()
        const bData = await bRes.json()
        if (cRes.ok) setConsignment(cData.rows || [])
        if (bRes.ok) setBuyouts(bData.rows || [])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load inventory')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [supabase, router])

  const updateConsignment = useCallback((id: string, patch: Partial<ConsignmentRow>) => {
    setConsignment(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
  }, [])

  const updateBuyout = useCallback((id: string, patch: Partial<BuyoutRow>) => {
    setBuyouts(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
  }, [])

  if (!authChecked && loading) {
    return (
      <div className="py-20 text-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  if (error) {
    return <div className="py-20 text-center text-sm text-red-600">Couldn&rsquo;t load inventory: {error}</div>
  }

  // Pending counts for the tab labels — show "needs attention" badges.
  const consignmentPending = consignment.filter(r => r.status === 'confirmed').length
  const buyoutPending = buyouts.filter(r => !r.carrier_claim_status || r.carrier_claim_status === 'pending' || r.carrier_claim_status === 'filed').length

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-900">Post-Exception Inventory</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Cards Nomi is consigning for the seller, or has paid out on, after authentication exceptions.
        </p>
      </div>

      <div className="flex items-center gap-1 mb-6 border-b border-zinc-200">
        <TabButton
          active={tab === 'consignment'}
          onClick={() => setTab('consignment')}
          label="Consignment"
          count={consignmentPending}
          total={consignment.length}
        />
        <TabButton
          active={tab === 'buyouts'}
          onClick={() => setTab('buyouts')}
          label="Buyouts"
          count={buyoutPending}
          total={buyouts.length}
        />
      </div>

      {tab === 'consignment' && (
        <ConsignmentTab rows={consignment} onUpdate={updateConsignment} />
      )}
      {tab === 'buyouts' && (
        <BuyoutsTab rows={buyouts} onUpdate={updateBuyout} />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Tab chrome
// ─────────────────────────────────────────────────────────────────

function TabButton({
  active, onClick, label, count, total,
}: {
  active: boolean; onClick: () => void; label: string; count: number; total: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
        active
          ? 'border-orange-500 text-orange-600'
          : 'border-transparent text-zinc-500 hover:text-zinc-900'
      }`}
    >
      {label}
      {count > 0 && (
        <span className="ml-2 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 tabular-nums">
          {count}
        </span>
      )}
      <span className="ml-1 text-xs text-zinc-400 tabular-nums">/{total}</span>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────
// Consignment tab
// ─────────────────────────────────────────────────────────────────

function ConsignmentTab({
  rows,
  onUpdate,
}: {
  rows: ConsignmentRow[]
  onUpdate: (id: string, patch: Partial<ConsignmentRow>) => void
}) {
  if (rows.length === 0) {
    return <EmptyState message="No consigned inventory. Items land here when authentication flags Incorrect Product, Conditional, or seller-attributable damage." />
  }
  return (
    <div className="space-y-2">
      {rows.map(row => (
        <ConsignmentRowCard key={row.id} row={row} onUpdate={onUpdate} />
      ))}
    </div>
  )
}

function ConsignmentRowCard({
  row,
  onUpdate,
}: {
  row: ConsignmentRow
  onUpdate: (id: string, patch: Partial<ConsignmentRow>) => void
}) {
  const item = unwrap(row.order_item)
  const seller = unwrap(row.seller)
  const [priceInput, setPriceInput] = useState(
    row.ask_price != null ? String(row.ask_price) : '',
  )
  const [savingPrice, setSavingPrice] = useState(false)
  const [savingStatus, setSavingStatus] = useState(false)
  const [rowError, setRowError] = useState<string | null>(null)

  async function savePrice() {
    const num = Number.parseFloat(priceInput)
    if (!Number.isFinite(num) || num < 0) {
      setRowError('Price must be ≥ 0')
      return
    }
    setSavingPrice(true)
    setRowError(null)
    try {
      const res = await fetch(`/api/admin/inventory/consignment/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ask_price: num }),
      })
      const data = await res.json()
      if (!res.ok) {
        setRowError(data.error || 'Save failed')
        return
      }
      onUpdate(row.id, { ask_price: num })
    } finally {
      setSavingPrice(false)
    }
  }

  async function changeStatus(nextStatus: ConsignmentRow['status']) {
    setSavingStatus(true)
    setRowError(null)
    try {
      const res = await fetch(`/api/admin/inventory/consignment/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      })
      const data = await res.json()
      if (!res.ok) {
        setRowError(data.error || 'Status update failed')
        return
      }
      onUpdate(row.id, { status: nextStatus })
    } finally {
      setSavingStatus(false)
    }
  }

  const statusTone: Record<ConsignmentRow['status'], string> = {
    confirmed: 'bg-amber-100 text-amber-800',
    listed: 'bg-blue-100 text-blue-700',
    sold: 'bg-emerald-100 text-emerald-700',
    rejected: 'bg-zinc-100 text-zinc-500',
  }
  // Ops-facing labels: 'confirmed' = in hand, awaiting relist; 'rejected'
  // = written off (can't be sold). Keeps the operator's mental model.
  const statusLabel: Record<ConsignmentRow['status'], string> = {
    confirmed: 'to list',
    listed: 'listed',
    sold: 'sold',
    rejected: 'written off',
  }

  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-medium text-zinc-900">{item?.card_name || item?.card_id || 'Unknown card'}</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-50 text-amber-700">
              {row.exception_type.replace('_', ' ')}
            </span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${statusTone[row.status]}`}>
              {statusLabel[row.status]}
            </span>
          </div>
          <p className="text-xs text-zinc-500">
            Originally from{' '}
            {seller?.username ? (
              <Link href={`/seller/${seller.username}`} className="text-orange-500 hover:text-orange-600">
                {seller.display_name || seller.username}
              </Link>
            ) : (
              <span>{seller?.display_name || 'Unknown seller'}</span>
            )}
            {item?.order_id && (
              <>
                {' · '}
                <Link href={`/admin/orders/${item.order_id}`} className="text-orange-500 hover:text-orange-600 font-mono">
                  #{item.order_id.slice(0, 8)}
                </Link>
              </>
            )}
            {' · '}
            <span>Consigned {timeAgo(row.created_at)}</span>
          </p>
        </div>
      </div>

      <div className="flex items-end gap-2 flex-wrap pt-3 border-t border-zinc-100">
        <div className="flex-1 min-w-[160px]">
          <label className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-1">
            Relist price
          </label>
          <div className="flex items-center gap-1">
            <span className="px-2.5 py-1.5 rounded-l-lg bg-zinc-100 text-zinc-500 text-sm border border-r-0 border-zinc-200">$</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={priceInput}
              onChange={e => setPriceInput(e.target.value)}
              placeholder="0.00"
              className="flex-1 px-3 py-1.5 border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
            <button
              type="button"
              onClick={savePrice}
              disabled={savingPrice}
              className="px-3 py-1.5 rounded-r-lg bg-zinc-900 text-white text-xs font-semibold hover:bg-zinc-800 disabled:opacity-50"
            >
              {savingPrice ? '…' : 'Save'}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {row.status === 'confirmed' && (
            <button
              type="button"
              onClick={() => changeStatus('listed')}
              disabled={savingStatus}
              className="px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold disabled:opacity-50"
            >
              Mark Listed
            </button>
          )}
          {row.status === 'listed' && (
            <button
              type="button"
              onClick={() => changeStatus('sold')}
              disabled={savingStatus}
              className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold disabled:opacity-50"
            >
              Mark Sold
            </button>
          )}
          {(row.status === 'confirmed' || row.status === 'listed') && (
            <button
              type="button"
              onClick={() => {
                if (confirm('Write off this consignment? Use for cards that can\'t be sold (e.g. proxy / unusable).')) {
                  changeStatus('rejected')
                }
              }}
              disabled={savingStatus}
              className="px-2.5 py-1.5 rounded-lg text-zinc-500 hover:bg-zinc-100 text-xs font-medium disabled:opacity-50"
            >
              Write off
            </button>
          )}
        </div>
      </div>

      {rowError && (
        <p className="mt-2 text-xs text-red-600">{rowError}</p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Buyouts tab
// ─────────────────────────────────────────────────────────────────

function BuyoutsTab({
  rows,
  onUpdate,
}: {
  rows: BuyoutRow[]
  onUpdate: (id: string, patch: Partial<BuyoutRow>) => void
}) {
  if (rows.length === 0) {
    return <EmptyState message="No buyouts on record. Items land here when authentication flags physical damage attributed to the courier or to Nomi." />
  }
  return (
    <div className="space-y-2">
      {rows.map(row => (
        <BuyoutRowCard key={row.id} row={row} onUpdate={onUpdate} />
      ))}
    </div>
  )
}

function BuyoutRowCard({
  row,
  onUpdate,
}: {
  row: BuyoutRow
  onUpdate: (id: string, patch: Partial<BuyoutRow>) => void
}) {
  const item = unwrap(row.order_item)
  const seller = unwrap(row.seller)
  const [claimId, setClaimId] = useState(row.carrier_claim_id || '')
  const [recovered, setRecovered] = useState(
    Number(row.recovered_amount || 0) > 0 ? String(row.recovered_amount) : '',
  )
  const [saving, setSaving] = useState(false)
  const [rowError, setRowError] = useState<string | null>(null)

  async function patch(body: Record<string, unknown>) {
    setSaving(true)
    setRowError(null)
    try {
      const res = await fetch(`/api/admin/inventory/buyouts/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setRowError(data.error || 'Save failed')
        return false
      }
      onUpdate(row.id, body as Partial<BuyoutRow>)
      return true
    } finally {
      setSaving(false)
    }
  }

  async function saveClaim() {
    await patch({ carrier_claim_id: claimId.trim() || null })
  }

  async function advanceTo(status: 'filed' | 'paid' | 'denied') {
    const body: Record<string, unknown> = { carrier_claim_status: status }
    if (status === 'paid') {
      const n = Number.parseFloat(recovered)
      if (!Number.isFinite(n) || n < 0) {
        setRowError('Enter recovered amount before marking paid')
        return
      }
      body.recovered_amount = n
    }
    await patch(body)
  }

  const claimStatus = row.carrier_claim_status || 'pending'
  const tone: Record<string, string> = {
    pending: 'bg-zinc-100 text-zinc-600',
    filed: 'bg-blue-100 text-blue-700',
    paid: 'bg-emerald-100 text-emerald-700',
    denied: 'bg-red-100 text-red-700',
  }

  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-medium text-zinc-900">{item?.card_name || item?.card_id || 'Unknown card'}</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-zinc-100 text-zinc-700">
              {row.reason.replace(':', ': ').replace('_', ' ')}
            </span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${tone[claimStatus]}`}>
              {claimStatus}
            </span>
          </div>
          <p className="text-xs text-zinc-500">
            Paid{' '}
            <span className="font-semibold text-zinc-700 tabular-nums">${Number(row.amount).toFixed(2)}</span>{' '}
            to{' '}
            {seller?.username ? (
              <Link href={`/seller/${seller.username}`} className="text-orange-500 hover:text-orange-600">
                {seller.display_name || seller.username}
              </Link>
            ) : (
              <span>{seller?.display_name || 'Unknown seller'}</span>
            )}
            {item?.order_id && (
              <>
                {' · '}
                <Link href={`/admin/orders/${item.order_id}`} className="text-orange-500 hover:text-orange-600 font-mono">
                  #{item.order_id.slice(0, 8)}
                </Link>
              </>
            )}
            {' · '}
            <span>{timeAgo(row.created_at)}</span>
          </p>
        </div>
      </div>

      <div className="flex items-end gap-2 flex-wrap pt-3 border-t border-zinc-100">
        {/* Claim ID input — always editable until status='paid' or 'denied'. */}
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-1">
            Carrier claim ID
          </label>
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={claimId}
              onChange={e => setClaimId(e.target.value)}
              placeholder="Shippo claim ref / USPS case #"
              disabled={claimStatus === 'paid' || claimStatus === 'denied'}
              className="flex-1 px-3 py-1.5 rounded-l-lg border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:bg-zinc-50 disabled:text-zinc-500"
            />
            <button
              type="button"
              onClick={saveClaim}
              disabled={saving || claimStatus === 'paid' || claimStatus === 'denied'}
              className="px-3 py-1.5 rounded-r-lg bg-zinc-900 text-white text-xs font-semibold hover:bg-zinc-800 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>

        {/* Recovered amount input (only when advancing to paid). */}
        {claimStatus !== 'paid' && claimStatus !== 'denied' && (
          <div className="w-32">
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-1">
              Recovered
            </label>
            <div className="flex items-center gap-0">
              <span className="px-2.5 py-1.5 rounded-l-lg bg-zinc-100 text-zinc-500 text-sm border border-r-0 border-zinc-200">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={recovered}
                onChange={e => setRecovered(e.target.value)}
                placeholder="0.00"
                className="flex-1 px-2 py-1.5 rounded-r-lg border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
          </div>
        )}

        {/* Status advance buttons — pending → filed → paid / denied. */}
        <div className="flex items-center gap-1.5">
          {claimStatus === 'pending' && (
            <button
              type="button"
              onClick={() => advanceTo('filed')}
              disabled={saving}
              className="px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold disabled:opacity-50"
            >
              Mark Filed
            </button>
          )}
          {(claimStatus === 'pending' || claimStatus === 'filed') && (
            <>
              <button
                type="button"
                onClick={() => advanceTo('paid')}
                disabled={saving}
                className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold disabled:opacity-50"
              >
                Mark Paid
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm('Mark this claim denied? No funds will be recovered.')) {
                    advanceTo('denied')
                  }
                }}
                disabled={saving}
                className="px-2.5 py-1.5 rounded-lg text-red-600 hover:bg-red-50 text-xs font-medium disabled:opacity-50"
              >
                Deny
              </button>
            </>
          )}
        </div>
      </div>

      {Number(row.recovered_amount || 0) > 0 && (
        <p className="mt-2 text-xs text-emerald-700">
          Recovered <span className="font-semibold tabular-nums">${Number(row.recovered_amount).toFixed(2)}</span>
          {row.recovered_at && ` on ${new Date(row.recovered_at).toLocaleDateString()}`}
        </p>
      )}

      {rowError && (
        <p className="mt-2 text-xs text-red-600">{rowError}</p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Shared bits
// ─────────────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-12 text-center text-sm text-zinc-500">
      {message}
    </div>
  )
}

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}
