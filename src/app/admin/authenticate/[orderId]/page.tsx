'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { ConditionBadge } from '@/components/marketplace/ConditionBadge'
import type { CardCondition, GradingCompany, OrderItem } from '@/types/database'

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

type Decision = 'authentic' | 'fake'
type Condition = 'near_mint' | 'exception'
type ExceptionType = 'incorrect_product' | 'conditional' | 'physical_damage'

interface IncorrectProductDetails {
  received_type: 'wrong_card' | 'slab' | 'raw'
  received_card_id?: string
  received_card_name?: string
}
interface ConditionalDetails {
  actual_condition: 'lightly_played' | 'heavily_played'
  damage_areas?: string[]
}
interface PhysicalDamageDetails {
  attribution: 'courier' | 'nomi' | 'seller'
  notes?: string
}
interface FakeDetails {
  disposition: 'return_to_seller' | 'destroyed'
}

interface ExceptionEntry {
  type: ExceptionType | 'fake'
  details: IncorrectProductDetails | ConditionalDetails | PhysicalDamageDetails | FakeDetails
}

/** The full per-item local state. Mirrors what the auth-decision
 *  endpoint expects. Kept in client state so the authenticator can
 *  flip between items without losing in-progress decisions. */
interface ItemState {
  decision: Decision | null
  condition: Condition | null
  exceptions: ExceptionEntry[]
}

interface OrderItemExt extends OrderItem {
  auth_decision?: string | null
  auth_condition?: string | null
  exception_types?: string[] | null
  exception_details?: Record<string, unknown> | null
}

interface OrderExt {
  id: string
  status: string
  buyer_id: string
  seller_id: string
  shipping_address: Record<string, unknown> | null
  items: OrderItemExt[]
  buyer?: { display_name: string; username: string | null }
  seller?: { display_name: string; username: string | null }
}

// ─────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────

export default function AdminAuthenticatePage() {
  const router = useRouter()
  const params = useParams()
  const orderId = params.orderId as string
  const supabase = useMemo(() => createClient(), [])

  const [order, setOrder] = useState<OrderExt | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [activeIdx, setActiveIdx] = useState(0)
  // Per-item local state. Source of truth before saveDecision flushes
  // to the server. Initialized from auth_decision columns on load.
  const [draft, setDraft] = useState<Record<string, ItemState>>({})
  const [savingItem, setSavingItem] = useState<string | null>(null)
  const [finalizing, setFinalizing] = useState(false)
  const [finalizeError, setFinalizeError] = useState<string | null>(null)
  const [cardImages, setCardImages] = useState<Record<string, string>>({})
  const didLoad = useRef(false)

  // ── Initial load: auth gate + fetch order + thumbnails ────────
  useEffect(() => {
    if (didLoad.current) return
    didLoad.current = true
    async function load() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { router.push('/auth/sign-in'); return }

        const { data: profile } = await supabase
          .from('profiles')
          .select('is_admin')
          .eq('id', user.id)
          .single()
        if (!profile?.is_admin) { router.push('/'); return }

        const [orderRes, itemsRes] = await Promise.all([
          supabase
            .from('orders')
            .select('*, buyer:profiles!orders_buyer_id_fkey(display_name, username), seller:profiles!orders_seller_id_fkey(display_name, username)')
            .eq('id', orderId)
            .single(),
          supabase
            .from('order_items')
            .select('*')
            .eq('order_id', orderId),
        ])
        if (!orderRes.data) {
          setLoadError('Order not found')
          return
        }
        const items = (itemsRes.data || []) as OrderItemExt[]
        const ord: OrderExt = { ...(orderRes.data as Omit<OrderExt, 'items'>), items }
        setOrder(ord)

        // Hydrate draft state from any previously-saved decisions so
        // the authenticator can pick up where they left off.
        const initialDraft: Record<string, ItemState> = {}
        for (const item of items) {
          if (!item.auth_decision || item.auth_decision === 'pending') {
            initialDraft[item.id] = { decision: null, condition: null, exceptions: [] }
            continue
          }
          const exTypes = item.exception_types || []
          const exDetails = (item.exception_details || {}) as Record<string, unknown>
          const exceptions: ExceptionEntry[] = exTypes.map(t => ({
            type: t as ExceptionType | 'fake',
            details: exDetails[t] as ExceptionEntry['details'],
          }))
          initialDraft[item.id] = {
            decision: item.auth_decision as Decision,
            condition: (item.auth_condition as Condition) || null,
            exceptions,
          }
        }
        setDraft(initialDraft)

        // Thumbnails for items without snapshot photos.
        const cardIds = [...new Set(items.filter(i => !i.snapshot_photo_url).map(i => i.card_id))]
        if (cardIds.length > 0) {
          try {
            const r = await fetch(`/api/cards?basic=1&ids=${encodeURIComponent(cardIds.join(','))}`)
            const d = await r.json()
            const imgs: Record<string, string> = {}
            for (const c of d.cards || []) {
              if (c.imageUrl) imgs[c.id] = c.imageUrl
            }
            setCardImages(imgs)
          } catch { /* thumbnails are decorative */ }
        }
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Failed to load order')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [supabase, router, orderId])

  // ── Active item helpers ───────────────────────────────────────
  const activeItem = order?.items[activeIdx]
  const activeDraft: ItemState = activeItem
    ? draft[activeItem.id] ?? { decision: null, condition: null, exceptions: [] }
    : { decision: null, condition: null, exceptions: [] }

  /** Update the active item's draft. Doesn't persist — saveActiveDraft
   *  flushes to the server. Letting the user accumulate edits locally
   *  before save avoids spamming the endpoint on every micro-change
   *  (e.g. typing in the Wrong Card name field). */
  const updateActiveDraft = useCallback(
    (next: Partial<ItemState> | ((prev: ItemState) => ItemState)) => {
      if (!activeItem) return
      setDraft(prev => {
        const cur = prev[activeItem.id] ?? { decision: null, condition: null, exceptions: [] }
        const merged = typeof next === 'function' ? next(cur) : { ...cur, ...next }
        return { ...prev, [activeItem.id]: merged }
      })
    },
    [activeItem],
  )

  /** Persist the active item's draft via auth-decision endpoint.
   *  Validates locally first to surface a clear error before the
   *  round-trip (the endpoint validates the same rules server-side
   *  for defense in depth). */
  const saveActiveDraft = useCallback(
    async (overrides?: Partial<ItemState>): Promise<boolean> => {
      if (!activeItem) return false
      const merged = { ...activeDraft, ...overrides }
      if (!merged.decision) return false
      // Local validation matches the server CHECK shape.
      if (merged.decision === 'authentic' && !merged.condition) return false
      if (merged.decision === 'authentic' && merged.condition === 'exception' && merged.exceptions.length === 0) return false
      if (merged.decision === 'fake' && merged.exceptions.length === 0) return false

      setSavingItem(activeItem.id)
      try {
        const body: Record<string, unknown> = { decision: merged.decision }
        if (merged.decision === 'authentic') body.condition = merged.condition
        if (merged.exceptions.length > 0) body.exceptions = merged.exceptions

        const res = await fetch(
          `/api/admin/orders/${orderId}/items/${activeItem.id}/auth-decision`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
        )
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          alert(err.error || 'Failed to save decision')
          return false
        }
        return true
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Failed to save decision')
        return false
      } finally {
        setSavingItem(null)
      }
    },
    [activeItem, activeDraft, orderId],
  )

  // ── Keyboard shortcuts ───────────────────────────────────────
  // GOAT-style: A=Authentic, F=Fake, N=Near Mint, E=Exception, Enter=save+next, Esc=clear.
  // Disabled when an input is focused so typing in a card-name field
  // doesn't trigger Authentic by accident.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return
      if (!activeItem) return

      const key = e.key.toLowerCase()
      if (key === 'a') {
        e.preventDefault()
        updateActiveDraft({ decision: 'authentic', condition: 'near_mint', exceptions: [] })
      } else if (key === 'f') {
        e.preventDefault()
        // Fake requires a disposition — pre-fill destroyed; admin can flip in panel.
        updateActiveDraft({
          decision: 'fake',
          condition: null,
          exceptions: [{ type: 'fake', details: { disposition: 'destroyed' } }],
        })
      } else if (key === 'n' && activeDraft.decision === 'authentic') {
        e.preventDefault()
        updateActiveDraft({ condition: 'near_mint', exceptions: [] })
      } else if (key === 'e' && activeDraft.decision === 'authentic') {
        e.preventDefault()
        updateActiveDraft({ condition: 'exception' })
      } else if (key === 'arrowright' || key === ']') {
        e.preventDefault()
        if (order && activeIdx < order.items.length - 1) setActiveIdx(activeIdx + 1)
      } else if (key === 'arrowleft' || key === '[') {
        e.preventDefault()
        if (activeIdx > 0) setActiveIdx(activeIdx - 1)
      } else if (key === 'enter') {
        e.preventDefault()
        // Save active + advance.
        saveActiveDraft().then(ok => {
          if (ok && order && activeIdx < order.items.length - 1) setActiveIdx(activeIdx + 1)
        })
      } else if (key === 'escape') {
        e.preventDefault()
        updateActiveDraft({ decision: null, condition: null, exceptions: [] })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeItem, activeDraft, activeIdx, order, updateActiveDraft, saveActiveDraft])

  // ── Finalize ─────────────────────────────────────────────────
  async function finalize() {
    if (!order) return
    setFinalizeError(null)
    // First save the active draft if there are unflushed edits.
    if (activeItem && activeDraft.decision) {
      const ok = await saveActiveDraft()
      if (!ok) return
    }
    setFinalizing(true)
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/finalize-auth`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setFinalizeError(data.error || 'Finalize failed')
        return
      }
      router.push(`/admin/orders/${orderId}`)
      router.refresh()
    } finally {
      setFinalizing(false)
    }
  }

  // ── Banner / progress ────────────────────────────────────────
  // Banner color reflects the *intent* of the active item's decision
  // so the next person to glance at the screen can sort the package
  // visually. Green = clean, yellow = exception, red = fake.
  const bannerTone = computeBannerTone(activeDraft)
  const decidedCount = order
    ? order.items.filter(i => {
        const d = draft[i.id]
        return d?.decision != null
      }).length
    : 0
  const totalCount = order?.items.length ?? 0

  // ── Render ───────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="py-20 text-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="py-20 text-center text-sm text-red-600">
        Couldn&rsquo;t load order: {loadError}
        <div className="mt-4">
          <Link href="/admin/orders" className="text-orange-500 hover:text-orange-600 font-medium">
            &larr; Back to Orders
          </Link>
        </div>
      </div>
    )
  }

  if (!order || !activeItem) return null

  if (order.status !== 'received' && order.status !== 'exception_review') {
    return (
      <div className="py-12 text-center">
        <h1 className="text-xl font-bold text-zinc-900 mb-2">
          This order can&rsquo;t be authenticated right now
        </h1>
        <p className="text-sm text-zinc-500 mb-6">
          Status is <span className="font-semibold">{order.status}</span>. Authentication is only available when the order is in <span className="font-mono">received</span> or <span className="font-mono">exception_review</span>.
        </p>
        <Link
          href={`/admin/orders/${order.id}`}
          className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm"
        >
          Back to Order
        </Link>
      </div>
    )
  }

  return (
    <div className="-mx-4 md:-mx-8">
      <StatusBanner tone={bannerTone} decidedCount={decidedCount} totalCount={totalCount} />

      <div className="flex items-center justify-between px-4 md:px-8 py-3 border-b border-zinc-200">
        <Link href={`/admin/orders/${order.id}`} className="text-sm text-zinc-500 hover:text-zinc-700">
          &larr; Order #{order.id.slice(0, 8)}
        </Link>
        <div className="text-xs text-zinc-500">
          Press <kbd className="px-1.5 py-0.5 rounded bg-zinc-100 font-mono">A</kbd> Authentic
          {' · '}
          <kbd className="px-1.5 py-0.5 rounded bg-zinc-100 font-mono">F</kbd> Fake
          {' · '}
          <kbd className="px-1.5 py-0.5 rounded bg-zinc-100 font-mono">N</kbd> Near Mint
          {' · '}
          <kbd className="px-1.5 py-0.5 rounded bg-zinc-100 font-mono">E</kbd> Exception
          {' · '}
          <kbd className="px-1.5 py-0.5 rounded bg-zinc-100 font-mono">↵</kbd> Save + Next
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 min-h-[calc(100vh-200px)]">
        {/* ── LEFT: item list + active item image gallery ─────── */}
        <div className="lg:col-span-3 border-r border-zinc-200 bg-zinc-50">
          <ItemList
            items={order.items}
            draft={draft}
            activeIdx={activeIdx}
            onPick={setActiveIdx}
            cardImages={cardImages}
          />
        </div>

        {/* ── CENTER: card image + decision controls ──────────── */}
        <div className="lg:col-span-5 p-6 bg-white">
          <CardImagePane item={activeItem} cardImages={cardImages} />

          <ItemDetail item={activeItem} />

          <div className="mt-6">
            <DecisionToggle
              value={activeDraft.decision}
              onChange={dec => {
                if (dec === 'authentic') {
                  updateActiveDraft({ decision: 'authentic', condition: activeDraft.condition ?? 'near_mint' })
                } else {
                  updateActiveDraft({
                    decision: 'fake',
                    condition: null,
                    exceptions: activeDraft.exceptions.find(e => e.type === 'fake')
                      ? activeDraft.exceptions
                      : [{ type: 'fake', details: { disposition: 'destroyed' } }],
                  })
                }
              }}
            />
          </div>

          {activeDraft.decision === 'authentic' && (
            <div className="mt-4">
              <ConditionToggle
                value={activeDraft.condition}
                onChange={cond => {
                  if (cond === 'near_mint') {
                    updateActiveDraft({ condition: 'near_mint', exceptions: [] })
                  } else {
                    updateActiveDraft({ condition: 'exception' })
                  }
                }}
              />
            </div>
          )}

          <div className="mt-8 flex items-center justify-between border-t border-zinc-100 pt-6">
            <button
              type="button"
              onClick={() => setActiveIdx(Math.max(0, activeIdx - 1))}
              disabled={activeIdx === 0}
              className="px-3 py-1.5 rounded text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              &larr; Prev
            </button>
            <button
              type="button"
              onClick={async () => {
                const ok = await saveActiveDraft()
                if (ok && activeIdx < order.items.length - 1) setActiveIdx(activeIdx + 1)
              }}
              disabled={savingItem !== null || !activeDraft.decision}
              className="px-4 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white font-semibold text-sm disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {savingItem ? 'Saving…' : 'Save + Next →'}
            </button>
          </div>
        </div>

        {/* ── RIGHT: exception subforms (when applicable) ─────── */}
        <div className="lg:col-span-4 border-l border-zinc-200 bg-zinc-50 p-6">
          <ExceptionPanel
            draft={activeDraft}
            onChange={updateActiveDraft}
          />
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="sticky bottom-0 bg-white border-t border-zinc-200 px-4 md:px-8 py-4 flex items-center justify-between">
        <div className="text-sm text-zinc-600">
          <span className="font-semibold text-zinc-900">{decidedCount}</span> of {totalCount} items decided
        </div>
        <div className="flex items-center gap-3">
          {finalizeError && (
            <span className="text-sm text-red-600">{finalizeError}</span>
          )}
          <button
            type="button"
            onClick={finalize}
            disabled={finalizing || decidedCount < totalCount}
            className="px-6 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm disabled:bg-orange-200 disabled:cursor-not-allowed transition-colors"
            title={decidedCount < totalCount ? 'All items must have a decision before finalizing' : ''}
          >
            {finalizing ? 'Finalizing…' : 'Finalize Authentication'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────

function computeBannerTone(d: ItemState): 'neutral' | 'green' | 'yellow' | 'red' {
  if (!d.decision) return 'neutral'
  if (d.decision === 'fake') return 'red'
  if (d.condition === 'near_mint') return 'green'
  return 'yellow'
}

function StatusBanner({
  tone,
  decidedCount,
  totalCount,
}: {
  tone: 'neutral' | 'green' | 'yellow' | 'red'
  decidedCount: number
  totalCount: number
}) {
  const styles: Record<typeof tone, string> = {
    neutral: 'bg-zinc-100 text-zinc-700',
    green: 'bg-emerald-100 text-emerald-800',
    yellow: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-800',
  }
  const labels: Record<typeof tone, string> = {
    neutral: 'Awaiting decision',
    green: 'Authentic — Near Mint',
    yellow: 'Authentic — Exception',
    red: 'Fake',
  }
  return (
    <div className={`px-4 md:px-8 py-2 text-sm font-semibold flex items-center justify-between ${styles[tone]}`}>
      <span>{labels[tone]}</span>
      <span className="text-xs">{decidedCount}/{totalCount} decided</span>
    </div>
  )
}

function ItemList({
  items,
  draft,
  activeIdx,
  onPick,
  cardImages,
}: {
  items: OrderItemExt[]
  draft: Record<string, ItemState>
  activeIdx: number
  onPick: (i: number) => void
  cardImages: Record<string, string>
}) {
  return (
    <div className="p-3 space-y-1">
      {items.map((item, i) => {
        const d = draft[item.id]
        const dotClass = d?.decision === 'fake'
          ? 'bg-red-500'
          : d?.condition === 'near_mint'
          ? 'bg-emerald-500'
          : d?.condition === 'exception'
          ? 'bg-amber-500'
          : 'bg-zinc-300'
        const img = item.snapshot_photo_url || cardImages[item.card_id]
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onPick(i)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
              i === activeIdx
                ? 'bg-white ring-2 ring-orange-500'
                : 'hover:bg-white'
            }`}
          >
            {img ? (
              <Image src={img} alt="" width={36} height={50} className="w-9 h-12 object-cover rounded flex-shrink-0" unoptimized />
            ) : (
              <div className="w-9 h-12 rounded bg-zinc-200 flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-900 truncate">
                {item.card_name || item.card_id}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={`w-2 h-2 rounded-full ${dotClass}`} />
                <span className="text-[11px] text-zinc-500 truncate">
                  {d?.decision === 'fake'
                    ? 'Fake'
                    : d?.condition === 'near_mint'
                    ? 'NM'
                    : d?.condition === 'exception'
                    ? `Exception (${d.exceptions.length})`
                    : 'Pending'}
                </span>
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

function CardImagePane({ item, cardImages }: { item: OrderItemExt; cardImages: Record<string, string> }) {
  const img = item.snapshot_photo_url || cardImages[item.card_id]
  if (!img) {
    return <div className="aspect-[2.5/3.5] max-w-xs mx-auto rounded-lg bg-zinc-100 flex items-center justify-center text-sm text-zinc-400">No image</div>
  }
  return (
    <div className="flex justify-center">
      <div className="relative aspect-[2.5/3.5] w-full max-w-xs rounded-lg overflow-hidden bg-zinc-100">
        <Image src={img} alt={item.card_name || ''} fill className="object-cover" unoptimized />
      </div>
    </div>
  )
}

function ItemDetail({ item }: { item: OrderItemExt }) {
  return (
    <div className="mt-5 text-center">
      <h2 className="text-lg font-bold text-zinc-900">{item.card_name || item.card_id}</h2>
      <div className="mt-2 flex items-center justify-center gap-2 flex-wrap">
        <ConditionBadge
          condition={item.condition as CardCondition}
          gradingCompany={(item as { grading_company?: GradingCompany | null }).grading_company || null}
          grade={(item as { grade?: string | null }).grade || null}
        />
        <span className="text-xs text-zinc-500">×{item.quantity}</span>
        <span className="text-xs text-zinc-500">Listed at ${Number(item.unit_price).toFixed(2)}</span>
      </div>
    </div>
  )
}

function DecisionToggle({
  value,
  onChange,
}: {
  value: Decision | null
  onChange: (d: Decision) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        onClick={() => onChange('authentic')}
        className={`px-4 py-3 rounded-lg font-bold text-sm transition-colors ${
          value === 'authentic'
            ? 'bg-emerald-600 text-white'
            : 'bg-white text-zinc-700 ring-1 ring-zinc-300 hover:ring-emerald-500'
        }`}
      >
        Authentic <span className="opacity-60 ml-1 text-xs">A</span>
      </button>
      <button
        type="button"
        onClick={() => onChange('fake')}
        className={`px-4 py-3 rounded-lg font-bold text-sm transition-colors ${
          value === 'fake'
            ? 'bg-red-600 text-white'
            : 'bg-white text-zinc-700 ring-1 ring-zinc-300 hover:ring-red-500'
        }`}
      >
        Fake <span className="opacity-60 ml-1 text-xs">F</span>
      </button>
    </div>
  )
}

function ConditionToggle({
  value,
  onChange,
}: {
  value: Condition | null
  onChange: (c: Condition) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        onClick={() => onChange('near_mint')}
        className={`px-4 py-3 rounded-lg font-semibold text-sm transition-colors ${
          value === 'near_mint'
            ? 'bg-emerald-500 text-white'
            : 'bg-white text-zinc-700 ring-1 ring-zinc-300 hover:ring-emerald-400'
        }`}
      >
        Near Mint <span className="opacity-60 ml-1 text-xs">N</span>
      </button>
      <button
        type="button"
        onClick={() => onChange('exception')}
        className={`px-4 py-3 rounded-lg font-semibold text-sm transition-colors ${
          value === 'exception'
            ? 'bg-amber-500 text-white'
            : 'bg-white text-zinc-700 ring-1 ring-zinc-300 hover:ring-amber-400'
        }`}
      >
        Exception <span className="opacity-60 ml-1 text-xs">E</span>
      </button>
    </div>
  )
}

function ExceptionPanel({
  draft,
  onChange,
}: {
  draft: ItemState
  onChange: (next: Partial<ItemState> | ((prev: ItemState) => ItemState)) => void
}) {
  if (!draft.decision) {
    return (
      <p className="text-sm text-zinc-400 italic">
        Pick Authentic or Fake to start
      </p>
    )
  }

  if (draft.decision === 'fake') {
    const fakeEx = draft.exceptions.find(e => e.type === 'fake')
    const disposition = (fakeEx?.details as FakeDetails | undefined)?.disposition || 'destroyed'
    return (
      <div>
        <h3 className="text-xs uppercase tracking-wide text-zinc-400 font-medium mb-3">
          Fake — Disposition
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {(['destroyed', 'return_to_seller'] as const).map(opt => (
            <button
              key={opt}
              type="button"
              onClick={() =>
                onChange({
                  exceptions: [{ type: 'fake', details: { disposition: opt } }],
                })
              }
              className={`px-3 py-3 rounded-lg text-sm font-semibold transition-colors ${
                disposition === opt
                  ? 'bg-red-600 text-white'
                  : 'bg-white text-zinc-700 ring-1 ring-zinc-300 hover:ring-red-400'
              }`}
            >
              {opt === 'destroyed' ? 'Destroy' : 'Return to seller'}
            </button>
          ))}
        </div>
        <p className="text-xs text-zinc-500 mt-3">
          Seller chose at intake. Confirm here. Destroy is irreversible — return ships at our cost.
        </p>
      </div>
    )
  }

  // authentic — only render exception subforms when condition='exception'
  if (draft.condition !== 'exception') {
    return (
      <p className="text-sm text-zinc-400 italic">
        Pick Near Mint or Exception
      </p>
    )
  }

  return (
    <div className="space-y-5">
      <h3 className="text-xs uppercase tracking-wide text-zinc-400 font-medium">
        Exception types — pick all that apply
      </h3>

      <ExceptionTypeToggle draft={draft} onChange={onChange} />

      {draft.exceptions.find(e => e.type === 'incorrect_product') && (
        <IncorrectProductForm draft={draft} onChange={onChange} />
      )}

      {draft.exceptions.find(e => e.type === 'conditional') && (
        <ConditionalForm draft={draft} onChange={onChange} />
      )}

      {draft.exceptions.find(e => e.type === 'physical_damage') && (
        <PhysicalDamageForm draft={draft} onChange={onChange} />
      )}
    </div>
  )
}

function ExceptionTypeToggle({
  draft,
  onChange,
}: {
  draft: ItemState
  onChange: (next: Partial<ItemState> | ((prev: ItemState) => ItemState)) => void
}) {
  const types: { key: ExceptionType; label: string; defaults: ExceptionEntry['details'] }[] = [
    { key: 'incorrect_product', label: 'Incorrect Product', defaults: { received_type: 'raw' } as IncorrectProductDetails },
    { key: 'conditional', label: 'Conditional', defaults: { actual_condition: 'lightly_played' } as ConditionalDetails },
    { key: 'physical_damage', label: 'Physical Damage', defaults: { attribution: 'seller' } as PhysicalDamageDetails },
  ]

  function toggle(type: ExceptionType, defaults: ExceptionEntry['details']) {
    onChange(prev => {
      const has = prev.exceptions.some(e => e.type === type)
      const next = has
        ? prev.exceptions.filter(e => e.type !== type)
        : [...prev.exceptions, { type, details: defaults }]
      return { ...prev, exceptions: next }
    })
  }

  return (
    <div className="grid grid-cols-1 gap-2">
      {types.map(t => {
        const active = draft.exceptions.some(e => e.type === t.key)
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => toggle(t.key, t.defaults)}
            className={`px-3 py-2.5 rounded-lg text-sm font-semibold text-left transition-colors ${
              active
                ? 'bg-amber-500 text-white'
                : 'bg-white text-zinc-700 ring-1 ring-zinc-300 hover:ring-amber-400'
            }`}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

function IncorrectProductForm({
  draft,
  onChange,
}: {
  draft: ItemState
  onChange: (next: Partial<ItemState> | ((prev: ItemState) => ItemState)) => void
}) {
  const entry = draft.exceptions.find(e => e.type === 'incorrect_product')
  const details = (entry?.details as IncorrectProductDetails) || { received_type: 'raw' }

  function updateDetails(d: Partial<IncorrectProductDetails>) {
    onChange(prev => ({
      ...prev,
      exceptions: prev.exceptions.map(e =>
        e.type === 'incorrect_product'
          ? { ...e, details: { ...details, ...d } }
          : e,
      ),
    }))
  }

  return (
    <div className="bg-white p-3 rounded-lg border border-zinc-200">
      <p className="text-xs font-bold uppercase tracking-wide text-zinc-500 mb-2">
        What did they actually send?
      </p>
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {(['wrong_card', 'slab', 'raw'] as const).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => updateDetails({ received_type: t })}
            className={`px-2 py-1.5 rounded text-xs font-semibold transition-colors ${
              details.received_type === t
                ? 'bg-zinc-900 text-white'
                : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
            }`}
          >
            {t === 'wrong_card' ? 'Wrong Card' : t === 'slab' ? 'Slab' : 'Raw'}
          </button>
        ))}
      </div>
      {details.received_type === 'wrong_card' && (
        <>
          {/* v1: free-text card ID. Search-style discovery deferred. */}
          <input
            type="text"
            placeholder="Card ID (e.g. OP07-119_p1)"
            value={details.received_card_id || ''}
            onChange={e => updateDetails({ received_card_id: e.target.value })}
            className="w-full px-3 py-2 rounded border border-zinc-200 text-sm font-mono"
          />
          <input
            type="text"
            placeholder="Card name (optional)"
            value={details.received_card_name || ''}
            onChange={e => updateDetails({ received_card_name: e.target.value })}
            className="w-full px-3 py-2 mt-1.5 rounded border border-zinc-200 text-sm"
          />
        </>
      )}
    </div>
  )
}

function ConditionalForm({
  draft,
  onChange,
}: {
  draft: ItemState
  onChange: (next: Partial<ItemState> | ((prev: ItemState) => ItemState)) => void
}) {
  const entry = draft.exceptions.find(e => e.type === 'conditional')
  const details = (entry?.details as ConditionalDetails) || { actual_condition: 'lightly_played' }

  function updateDetails(d: Partial<ConditionalDetails>) {
    onChange(prev => ({
      ...prev,
      exceptions: prev.exceptions.map(e =>
        e.type === 'conditional'
          ? { ...e, details: { ...details, ...d } }
          : e,
      ),
    }))
  }

  function toggleArea(area: string) {
    const cur = details.damage_areas || []
    const next = cur.includes(area) ? cur.filter(a => a !== area) : [...cur, area]
    updateDetails({ damage_areas: next })
  }

  return (
    <div className="bg-white p-3 rounded-lg border border-zinc-200">
      <p className="text-xs font-bold uppercase tracking-wide text-zinc-500 mb-2">
        Actual condition
      </p>
      <div className="grid grid-cols-2 gap-1.5 mb-3">
        {(['lightly_played', 'heavily_played'] as const).map(c => (
          <button
            key={c}
            type="button"
            onClick={() => updateDetails({ actual_condition: c })}
            className={`px-2 py-1.5 rounded text-xs font-semibold transition-colors ${
              details.actual_condition === c
                ? 'bg-zinc-900 text-white'
                : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
            }`}
          >
            {c === 'lightly_played' ? 'Lightly Played' : 'Heavily Played'}
          </button>
        ))}
      </div>
      <p className="text-xs font-bold uppercase tracking-wide text-zinc-500 mb-2">
        Damage areas
      </p>
      <div className="flex flex-wrap gap-1.5">
        {['surface', 'corners', 'edges'].map(area => {
          const active = (details.damage_areas || []).includes(area)
          return (
            <button
              key={area}
              type="button"
              onClick={() => toggleArea(area)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors capitalize ${
                active
                  ? 'bg-amber-500 text-white'
                  : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
              }`}
            >
              {area}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function PhysicalDamageForm({
  draft,
  onChange,
}: {
  draft: ItemState
  onChange: (next: Partial<ItemState> | ((prev: ItemState) => ItemState)) => void
}) {
  const entry = draft.exceptions.find(e => e.type === 'physical_damage')
  const details = (entry?.details as PhysicalDamageDetails) || { attribution: 'seller' }

  function updateDetails(d: Partial<PhysicalDamageDetails>) {
    onChange(prev => ({
      ...prev,
      exceptions: prev.exceptions.map(e =>
        e.type === 'physical_damage'
          ? { ...e, details: { ...details, ...d } }
          : e,
      ),
    }))
  }

  return (
    <div className="bg-white p-3 rounded-lg border border-zinc-200">
      <p className="text-xs font-bold uppercase tracking-wide text-zinc-500 mb-2">
        Who damaged it?
      </p>
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {(['courier', 'nomi', 'seller'] as const).map(a => (
          <button
            key={a}
            type="button"
            onClick={() => updateDetails({ attribution: a })}
            className={`px-2 py-1.5 rounded text-xs font-semibold transition-colors capitalize ${
              details.attribution === a
                ? 'bg-zinc-900 text-white'
                : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
            }`}
          >
            {a === 'nomi' ? 'Nomi' : a}
          </button>
        ))}
      </div>
      <textarea
        placeholder="Notes (visible damage, photo refs, etc.)"
        value={details.notes || ''}
        onChange={e => updateDetails({ notes: e.target.value })}
        rows={2}
        className="w-full px-3 py-2 rounded border border-zinc-200 text-sm resize-none"
      />
      <p className="text-xs text-zinc-500 mt-2">
        Courier or Nomi attribution triggers a buyout. Seller attribution sends the card to consignment.
      </p>
    </div>
  )
}
