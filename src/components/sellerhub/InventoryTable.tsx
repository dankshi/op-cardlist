'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { ConditionBadge } from '@/components/marketplace/ConditionBadge'
import { calculatePayout } from '@/lib/fees'
import type { Listing, SellerTier } from '@/types/database'

interface Props {
  listings: Listing[]
  onListingsChange: (next: Listing[]) => void
  cardImages: Record<string, string>
  marketPrices: Record<string, number>
  tier: SellerTier
}

type StatusFilter = 'active' | 'delisted'
type BulkMode = 'pct_market' | 'pct_change' | 'flat_change' | 'set_price'

const BULK_LABELS: Record<BulkMode, string> = {
  pct_market: '% of market price',
  pct_change: 'Adjust by %',
  flat_change: 'Adjust by $',
  set_price: 'Set price to $',
}

/** Dense, editable inventory table — the headline of the Seller Hub.
 *  Inline price/qty textboxes write straight to Supabase (RLS scopes to
 *  the owner), and the bulk toolbar repricing operates on the checked
 *  rows. Generalizes the %-vs-market modal from /mystuff. */
export function InventoryTable({ listings, onListingsChange, cardImages, marketPrices, tier }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const [bulkMode, setBulkMode] = useState<BulkMode>('pct_market')
  const [bulkValue, setBulkValue] = useState('95')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkMsg, setBulkMsg] = useState<string | null>(null)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const tokens = q ? q.split(/\s+/) : []
    return listings
      .filter(l => l.status === statusFilter)
      .filter(l => tokens.length === 0 || tokens.every(t => `${l.title} ${l.card_id}`.toLowerCase().includes(t)))
  }, [listings, statusFilter, query])

  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.id))

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map(r => r.id)))
  }
  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function patchListing(updated: Listing) {
    onListingsChange(listings.map(l => l.id === updated.id ? updated : l))
  }

  // Compute the proposed new price for a listing under the current bulk
  // mode. Returns null when the op can't apply (e.g. no market price).
  function nextPriceFor(l: Listing): number | null {
    const v = parseFloat(bulkValue)
    if (!Number.isFinite(v)) return null
    const market = marketPrices[l.card_id]
    let p: number
    switch (bulkMode) {
      case 'pct_market':
        if (!market) return null
        p = market * (v / 100)
        break
      case 'pct_change':
        p = Number(l.price) * (1 + v / 100)
        break
      case 'flat_change':
        p = Number(l.price) + v
        break
      case 'set_price':
        p = v
        break
    }
    return Math.max(0.01, Math.round(p * 100) / 100)
  }

  async function applyBulk() {
    const targets = rows.filter(r => selected.has(r.id))
    if (targets.length === 0) { setBulkMsg('Select at least one row.'); return }
    setBulkBusy(true)
    setBulkMsg(null)

    let updated = 0
    let skipped = 0
    const nextListings = [...listings]
    for (const l of targets) {
      const newPrice = nextPriceFor(l)
      if (newPrice == null || newPrice === Number(l.price)) { skipped++; continue }
      const { error } = await supabase.from('listings').update({ price: newPrice }).eq('id', l.id)
      if (error) { skipped++; continue }
      const idx = nextListings.findIndex(x => x.id === l.id)
      if (idx >= 0) nextListings[idx] = { ...nextListings[idx], price: newPrice }
      updated++
    }
    onListingsChange(nextListings)
    setBulkBusy(false)
    setBulkMsg(`Updated ${updated} listing${updated === 1 ? '' : 's'}${skipped ? `, skipped ${skipped}` : ''}.`)
    setSelected(new Set())
  }

  const showBulkBar = selected.size > 0

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-zinc-200 overflow-hidden">
          {(['active', 'delisted'] as StatusFilter[]).map(s => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setSelected(new Set()) }}
              className={`px-3 py-2 text-sm font-medium transition-colors ${
                statusFilter === s ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-600 hover:bg-zinc-50'
              }`}
            >
              {s === 'active' ? 'Active' : 'Collection'}
              <span className="ml-1.5 text-xs opacity-70">
                {listings.filter(l => l.status === s).length}
              </span>
            </button>
          ))}
        </div>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search name or card #…"
          className="flex-1 min-w-[200px] px-3 py-2 bg-white border border-zinc-200 rounded-lg text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
        />
        <p className="text-xs text-zinc-500">{rows.length} row{rows.length === 1 ? '' : 's'}</p>
      </div>

      {/* Bulk price bar — appears when rows are checked */}
      {showBulkBar && (
        <div className="flex flex-wrap items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg p-3">
          <span className="text-sm font-semibold text-orange-800">{selected.size} selected</span>
          <select
            value={bulkMode}
            onChange={e => setBulkMode(e.target.value as BulkMode)}
            className="px-2 py-1.5 rounded-md border border-zinc-200 bg-white text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
          >
            {(Object.keys(BULK_LABELS) as BulkMode[]).map(m => (
              <option key={m} value={m}>{BULK_LABELS[m]}</option>
            ))}
          </select>
          <input
            type="number"
            step="0.01"
            value={bulkValue}
            onChange={e => setBulkValue(e.target.value)}
            className="w-24 px-2 py-1.5 rounded-md border border-zinc-200 bg-white text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          <button
            onClick={applyBulk}
            disabled={bulkBusy}
            className="px-3 py-1.5 rounded-md bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition-colors cursor-pointer disabled:opacity-50"
          >
            {bulkBusy ? 'Applying…' : 'Apply'}
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="px-2 py-1.5 text-sm text-zinc-500 hover:text-zinc-900 cursor-pointer"
          >
            Clear
          </button>
          {bulkMode === 'pct_market' && (
            <span className="text-[11px] text-orange-700/70">Rows without a known market price are skipped.</span>
          )}
          {bulkMsg && <span className="text-xs text-zinc-600">{bulkMsg}</span>}
        </div>
      )}

      {/* Table */}
      {rows.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-xl p-12 text-center text-sm text-zinc-500">
          {statusFilter === 'active' ? (
            <>No active listings. <Link href="#" className="text-orange-600 font-medium">Add some in the Add Listings tab.</Link></>
          ) : 'Nothing parked in your collection.'}
        </div>
      ) : (
        <div className="overflow-x-auto bg-white border border-zinc-200 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500">
                <th className="px-3 py-2.5 w-8">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-orange-500" />
                </th>
                <th className="px-3 py-2.5">Card</th>
                <th className="px-3 py-2.5">Variant</th>
                <th className="px-3 py-2.5">Price</th>
                <th className="px-3 py-2.5">Qty</th>
                <th className="px-3 py-2.5 text-right">Market</th>
                <th className="px-3 py-2.5 text-right">Est. payout</th>
                <th className="px-3 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(l => (
                <InventoryRow
                  key={l.id}
                  listing={l}
                  selected={selected.has(l.id)}
                  onToggle={() => toggleOne(l.id)}
                  imageUrl={l.photo_urls?.[0] || cardImages[l.card_id] || null}
                  market={marketPrices[l.card_id]}
                  tier={tier}
                  supabase={supabase}
                  onChange={patchListing}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function InventoryRow({
  listing, selected, onToggle, imageUrl, market, tier, supabase, onChange,
}: {
  listing: Listing
  selected: boolean
  onToggle: () => void
  imageUrl: string | null
  market: number | undefined
  tier: SellerTier
  supabase: ReturnType<typeof createClient>
  onChange: (l: Listing) => void
}) {
  const [price, setPrice] = useState(Number(listing.price).toFixed(2))
  const [qty, setQty] = useState(String(listing.quantity_available))
  const [saving, setSaving] = useState<'price' | 'qty' | null>(null)
  const [flash, setFlash] = useState<'ok' | 'err' | null>(null)

  function signalFlash(kind: 'ok' | 'err') {
    setFlash(kind)
    setTimeout(() => setFlash(null), 1200)
  }

  async function savePrice() {
    const parsed = parseFloat(price)
    if (!Number.isFinite(parsed) || parsed <= 0) { setPrice(Number(listing.price).toFixed(2)); signalFlash('err'); return }
    if (parsed === Number(listing.price)) return
    setSaving('price')
    const { error } = await supabase.from('listings').update({ price: parsed }).eq('id', listing.id)
    setSaving(null)
    if (error) { signalFlash('err'); return }
    onChange({ ...listing, price: parsed })
    signalFlash('ok')
  }

  async function saveQty() {
    const parsed = Math.floor(Number(qty))
    if (!Number.isFinite(parsed) || parsed < 0) { setQty(String(listing.quantity_available)); signalFlash('err'); return }
    if (parsed === listing.quantity_available) return
    setSaving('qty')
    // Keep total quantity in step so quantity_available never exceeds it.
    const nextQuantity = Math.max(listing.quantity, parsed)
    const { error } = await supabase
      .from('listings')
      .update({ quantity_available: parsed, quantity: nextQuantity })
      .eq('id', listing.id)
    setSaving(null)
    if (error) { signalFlash('err'); return }
    onChange({ ...listing, quantity_available: parsed, quantity: nextQuantity })
    signalFlash('ok')
  }

  async function setStatus(status: Listing['status']) {
    const { error } = await supabase.from('listings').update({ status }).eq('id', listing.id)
    if (error) { alert(`Failed: ${error.message}`); return }
    onChange({ ...listing, status })
  }

  const payout = calculatePayout({
    salePrice: Number(price) || Number(listing.price),
    fulfillment: listing.fulfillment_method || 'ship',
    tier,
    isRaw: !listing.grading_company,
  }).payout

  return (
    <tr className={`border-b border-zinc-100 last:border-0 ${selected ? 'bg-orange-50/40' : 'hover:bg-zinc-50/60'}`}>
      <td className="px-3 py-2">
        <input type="checkbox" checked={selected} onChange={onToggle} className="accent-orange-500" />
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2 min-w-[200px]">
          <div className="relative w-8 h-11 shrink-0 rounded bg-zinc-100 overflow-hidden">
            {imageUrl && (
              <Image src={imageUrl} alt="" fill sizes="32px" className="object-cover" unoptimized />
            )}
          </div>
          <div className="min-w-0">
            <p className="font-medium text-zinc-900 truncate max-w-[220px]">{listing.title}</p>
            <p className="text-xs text-zinc-400">{listing.card_id}</p>
          </div>
        </div>
      </td>
      <td className="px-3 py-2">
        <ConditionBadge condition={listing.condition} gradingCompany={listing.grading_company} grade={listing.grade} />
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1">
          <span className="text-zinc-400">$</span>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={price}
            onChange={e => setPrice(e.target.value)}
            onBlur={savePrice}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            className="w-20 px-1.5 py-1 rounded border border-zinc-200 tabular-nums text-zinc-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          {saving === 'price' && <span className="text-[10px] text-zinc-400">…</span>}
          {flash === 'ok' && <span className="text-emerald-500 text-xs">✓</span>}
          {flash === 'err' && <span className="text-red-500 text-xs">!</span>}
        </div>
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          min="0"
          step="1"
          value={qty}
          onChange={e => setQty(e.target.value)}
          onBlur={saveQty}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          className="w-14 px-1.5 py-1 rounded border border-zinc-200 tabular-nums text-zinc-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
        />
        {saving === 'qty' && <span className="ml-1 text-[10px] text-zinc-400">…</span>}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-zinc-600">
        {market != null ? `$${market.toFixed(2)}` : <span className="text-zinc-300">—</span>}
      </td>
      <td className="px-3 py-2 text-right tabular-nums font-medium text-emerald-700">
        ${payout.toFixed(2)}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-1.5">
          <Link
            href={`/sell/${listing.id}/edit`}
            className="px-2 py-1 rounded text-[11px] font-semibold uppercase tracking-wider text-orange-600 ring-1 ring-orange-500/40 hover:bg-orange-500 hover:text-white transition-colors"
          >
            Edit
          </Link>
          {listing.status === 'active' ? (
            <button
              onClick={() => setStatus('delisted')}
              className="px-2 py-1 rounded text-[11px] font-semibold uppercase tracking-wider text-zinc-500 ring-1 ring-zinc-200 hover:bg-zinc-100 transition-colors cursor-pointer"
              title="Move to collection (stop selling)"
            >
              Delist
            </button>
          ) : (
            <button
              onClick={() => setStatus('active')}
              className="px-2 py-1 rounded text-[11px] font-semibold uppercase tracking-wider text-emerald-700 ring-1 ring-emerald-500/40 hover:bg-emerald-600 hover:text-white transition-colors cursor-pointer"
              title="List for sale"
            >
              List
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}
