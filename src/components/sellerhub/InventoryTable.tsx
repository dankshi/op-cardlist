'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { calculatePayout } from '@/lib/fees'
import { GRADING_SCALES, type GradingCompany, type Listing, type SellerTier } from '@/types/database'

/** Reduce a listing title to just the card name for the inventory table,
 *  which has its own Grade column and a card_id subtitle. Titles come in a
 *  few shapes — "Sanji (OP01-013_p2) - PSA 10", "Luffy (BGS 9.5)",
 *  "Luffy (NM)" — so we cut at the card_id parenthetical when present
 *  (dropping the code and any grade tail after it), otherwise strip a
 *  trailing grade/condition parenthetical using the listing's own fields. */
function baseTitle(listing: Listing): string {
  const t = listing.title
  const idIdx = t.toLowerCase().indexOf(`(${listing.card_id.toLowerCase()})`)
  if (idIdx > 0) return t.slice(0, idIdx).trim() || t
  const suffix = listing.grading_company && listing.grade
    ? ` (${listing.grading_company} ${listing.grade})`
    : ' (NM)'
  return t.endsWith(suffix) ? t.slice(0, -suffix.length) : t
}

interface Props {
  listings: Listing[]
  onListingsChange: (next: Listing[]) => void
  cardImages: Record<string, string>
  marketPrices: Record<string, number>
  tier: SellerTier
}

type StatusFilter = 'active' | 'delisted'
type BulkMode = 'pct_market' | 'pct_change' | 'flat_change' | 'set_price'
type SortKey = 'card' | 'company' | 'grade' | 'price' | 'qty' | 'market' | 'payout'
type SortState = { key: SortKey; dir: 'asc' | 'desc' }

/** Map a grade onto a sortable number: the two named top tiers rank just
 *  above a numeric 10, real grades sort by value, and raw cards (no grade)
 *  fall to the bottom. */
function gradeRank(l: Listing): number {
  if (!l.grade) return -1
  if (l.grade === 'Black Label 10' || l.grade === 'Pristine 10') return 10.1
  const n = parseFloat(l.grade)
  return Number.isFinite(n) ? n : -1
}

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
  const [sort, setSort] = useState<SortState | null>(null)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const tokens = q ? q.split(/\s+/) : []
    return listings
      .filter(l => l.status === statusFilter)
      .filter(l => tokens.length === 0 || tokens.every(t => `${l.title} ${l.card_id}`.toLowerCase().includes(t)))
  }, [listings, statusFilter, query])

  // Apply the active column sort on top of the filtered rows. Numeric
  // columns compare as numbers; text columns via localeCompare. Cleared
  // sort (null) keeps the natural listing order.
  const sortedRows = useMemo(() => {
    if (!sort) return rows
    const dir = sort.dir === 'asc' ? 1 : -1
    const valueOf = (l: Listing): number | string => {
      switch (sort.key) {
        case 'card': return baseTitle(l).toLowerCase()
        case 'company': return l.grading_company ?? ''
        case 'grade': return gradeRank(l)
        case 'price': return Number(l.price)
        case 'qty': return l.quantity_available
        case 'market': return marketPrices[l.card_id] ?? -1
        case 'payout': return calculatePayout({
          salePrice: Number(l.price),
          fulfillment: l.fulfillment_method || 'ship',
          tier,
          isRaw: !l.grading_company,
        }).payout
      }
    }
    return [...rows].sort((a, b) => {
      const av = valueOf(a), bv = valueOf(b)
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av).localeCompare(String(bv)) * dir
      }
      return (av - bv) * dir
    })
  }, [rows, sort, marketPrices, tier])

  // Cycle a column: unsorted → asc → desc → unsorted.
  function toggleSort(key: SortKey) {
    setSort(prev => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' }
      if (prev.dir === 'asc') return { key, dir: 'desc' }
      return null
    })
  }

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

  function removeListing(id: string) {
    onListingsChange(listings.filter(l => l.id !== id))
    setSelected(prev => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
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
    return Math.max(1, Math.round(p))
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
              {s === 'active' ? 'Active' : 'Unlisted'}
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
            step="1"
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
                <SortHeader label="Card" sortKey="card" sort={sort} onSort={toggleSort} />
                <SortHeader label="Company" sortKey="company" sort={sort} onSort={toggleSort} />
                <SortHeader label="Grade" sortKey="grade" sort={sort} onSort={toggleSort} />
                <SortHeader label="Price" sortKey="price" sort={sort} onSort={toggleSort} />
                <SortHeader label="Qty" sortKey="qty" sort={sort} onSort={toggleSort} />
                <SortHeader label="Market" sortKey="market" sort={sort} onSort={toggleSort} align="right" />
                <SortHeader label="Est. payout" sortKey="payout" sort={sort} onSort={toggleSort} align="right" />
                <th className="px-3 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(l => (
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
                  onDelete={removeListing}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** Clickable column header. Shows a faint ↕ when inactive and ▲/▼ for the
 *  active sort direction. */
function SortHeader({
  label, sortKey, sort, onSort, align = 'left',
}: {
  label: string
  sortKey: SortKey
  sort: SortState | null
  onSort: (key: SortKey) => void
  align?: 'left' | 'right'
}) {
  const active = sort?.key === sortKey
  return (
    <th className={`px-3 py-2.5 ${align === 'right' ? 'text-right' : ''}`}>
      <button
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 uppercase tracking-wide cursor-pointer transition-colors hover:text-zinc-900 ${active ? 'text-zinc-900' : ''}`}
      >
        {label}
        <span className={`text-[9px] ${active ? '' : 'text-zinc-300'}`}>
          {active ? (sort!.dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  )
}

function InventoryRow({
  listing, selected, onToggle, imageUrl, market, tier, supabase, onChange, onDelete,
}: {
  listing: Listing
  selected: boolean
  onToggle: () => void
  imageUrl: string | null
  market: number | undefined
  tier: SellerTier
  supabase: ReturnType<typeof createClient>
  onChange: (l: Listing) => void
  onDelete: (id: string) => void
}) {
  const [price, setPrice] = useState(String(Math.round(Number(listing.price))))
  const [qty, setQty] = useState(String(listing.quantity_available))
  const [saving, setSaving] = useState<'price' | 'qty' | null>(null)
  const [flash, setFlash] = useState<'ok' | 'err' | null>(null)
  const [editing, setEditing] = useState(false)

  function signalFlash(kind: 'ok' | 'err') {
    setFlash(kind)
    setTimeout(() => setFlash(null), 1200)
  }

  async function savePrice() {
    const parsed = Math.round(Number(price))
    if (!Number.isFinite(parsed) || parsed <= 0) { setPrice(String(Math.round(Number(listing.price)))); signalFlash('err'); return }
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

  // FK from order_items has no ON DELETE CASCADE, so a listing with platform
  // sales can't be hard-deleted. We hide Delete in that case (see actions
  // cell), but still defend against the constraint here just in case.
  const hasOrderHistory = listing.quantity_available < listing.quantity

  async function deleteListing() {
    if (!confirm(`Permanently delete "${baseTitle(listing)}"? This can't be undone. If you just want to stop selling it, use Delist to move it to your collection instead.`)) return
    const { error } = await supabase.from('listings').delete().eq('id', listing.id)
    if (error) {
      if (/foreign key|violates/i.test(error.message)) {
        alert("This card has order history and can't be permanently deleted. Check your Orders tab to find the sale.")
        return
      }
      alert(`Failed to delete: ${error.message}`)
      return
    }
    onDelete(listing.id)
  }

  const payout = calculatePayout({
    salePrice: Number(price) || Number(listing.price),
    fulfillment: listing.fulfillment_method || 'ship',
    tier,
    isRaw: !listing.grading_company,
  }).payout

  return (
    <>
    <tr className={`border-b border-zinc-100 ${editing ? '' : 'last:border-0'} ${selected ? 'bg-orange-50/40' : 'hover:bg-zinc-50/60'}`}>
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
            <p className="font-medium text-zinc-900 truncate max-w-[220px]">{baseTitle(listing)}</p>
            <p className="text-xs text-zinc-400">{listing.card_id}</p>
          </div>
        </div>
      </td>
      <td className="px-3 py-2">
        {listing.grading_company
          ? <span className="text-xs font-semibold uppercase tracking-wider text-zinc-700">{listing.grading_company}</span>
          : <span className="text-zinc-300">—</span>}
      </td>
      <td className="px-3 py-2">
        {listing.grade
          ? <span className="font-medium text-zinc-900 tabular-nums">{listing.grade}</span>
          : <span className="text-zinc-500">Near Mint</span>}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1">
          <span className="text-zinc-400">$</span>
          <input
            type="number"
            step="1"
            min="1"
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
        {market != null ? `$${Math.round(market).toLocaleString()}` : <span className="text-zinc-300">—</span>}
      </td>
      <td className="px-3 py-2 text-right tabular-nums font-medium text-emerald-700">
        ${Math.round(payout).toLocaleString()}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-1.5">
          <button
            onClick={() => setEditing(e => !e)}
            className={`px-2 py-1 rounded text-[11px] font-semibold uppercase tracking-wider ring-1 transition-colors cursor-pointer ${
              editing
                ? 'bg-orange-500 text-white ring-orange-500'
                : 'text-orange-600 ring-orange-500/40 hover:bg-orange-500 hover:text-white'
            }`}
            title="Edit grade, condition & language inline"
          >
            Edit
          </button>
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
          {/* Hard delete — only for listings with no platform sales (sold
              elsewhere, mistakes). Cards with order history can only be
              delisted, so Delete is hidden for them. */}
          {!hasOrderHistory && (
            <button
              onClick={deleteListing}
              className="px-2 py-1 rounded text-[11px] font-semibold uppercase tracking-wider text-rose-600 ring-1 ring-rose-500/40 hover:bg-rose-500 hover:text-white transition-colors cursor-pointer"
              title="Permanently delete this listing (e.g. sold elsewhere)"
            >
              Delete
            </button>
          )}
        </div>
      </td>
    </tr>
    {editing && (
      <InlineEditor
        listing={listing}
        supabase={supabase}
        onChange={onChange}
        onClose={() => setEditing(false)}
      />
    )}
    </>
  )
}

// Only grades 8+ are eligible to list — mirrors the full editor page.
function isGradeEligible(grade: string): boolean {
  if (grade === 'Black Label 10' || grade === 'Pristine 10') return true
  const num = parseFloat(grade)
  return !isNaN(num) && num >= 8
}

/** Expandable in-table editor for the fields the row doesn't already
 *  cover inline (price/qty live in the row itself): raw-vs-graded,
 *  grading company, grade and language. Writes straight to Supabase and
 *  regenerates the title so its grade parenthetical stays in sync.
 *  Photos still live on the full /sell/:id/edit page, linked below. */
function InlineEditor({
  listing, supabase, onChange, onClose,
}: {
  listing: Listing
  supabase: ReturnType<typeof createClient>
  onChange: (l: Listing) => void
  onClose: () => void
}) {
  const [isGraded, setIsGraded] = useState(!!listing.grading_company)
  const [gradingCompany, setGradingCompany] = useState<GradingCompany | null>(listing.grading_company ?? null)
  const [grade, setGrade] = useState(listing.grade ?? '')
  const [language, setLanguage] = useState(listing.language)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    if (isGraded && (!gradingCompany || !grade)) { setErr('Pick a grading company and grade.'); return }
    setSaving(true)
    setErr(null)

    const nextCompany = isGraded ? gradingCompany : null
    const nextGrade = isGraded ? grade : null
    const base = baseTitle(listing)
    const nextTitle = nextCompany && nextGrade ? `${base} (${nextCompany} ${nextGrade})` : `${base} (NM)`
    // Graded slabs are sold in-holder, so drop any raw photos when switching.
    const nextPhotos = nextCompany ? [] : listing.photo_urls

    const { error } = await supabase
      .from('listings')
      .update({
        grading_company: nextCompany,
        grade: nextGrade,
        language,
        title: nextTitle,
        photo_urls: nextPhotos,
      })
      .eq('id', listing.id)

    setSaving(false)
    if (error) { setErr(error.message); return }
    onChange({ ...listing, grading_company: nextCompany, grade: nextGrade, language, title: nextTitle, photo_urls: nextPhotos })
    onClose()
  }

  const grades = gradingCompany
    ? GRADING_SCALES[gradingCompany].filter(isGradeEligible)
    : []

  return (
    <tr className="border-b border-zinc-100 last:border-0 bg-orange-50/30">
      <td colSpan={9} className="px-3 py-4">
        <div className="flex flex-wrap items-end gap-4">
          {/* Raw / Graded */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">Type</label>
            <div className="inline-flex rounded-lg border border-zinc-200 overflow-hidden">
              {([['raw', 'Raw'], ['graded', 'Graded']] as const).map(([key, label]) => {
                const active = (key === 'graded') === isGraded
                return (
                  <button
                    key={key}
                    onClick={() => setIsGraded(key === 'graded')}
                    className={`px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
                      active ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-600 hover:bg-zinc-50'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Grading company + grade (graded only) */}
          {isGraded && (
            <>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">Company</label>
                <select
                  value={gradingCompany ?? ''}
                  onChange={e => { setGradingCompany(e.target.value as GradingCompany); setGrade('') }}
                  className="px-2 py-1.5 rounded-md border border-zinc-200 bg-white text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  <option value="" disabled>Select…</option>
                  {(['PSA', 'CGC', 'BGS', 'TAG'] as GradingCompany[]).map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">Grade</label>
                <select
                  value={grade}
                  onChange={e => setGrade(e.target.value)}
                  disabled={!gradingCompany}
                  className="px-2 py-1.5 rounded-md border border-zinc-200 bg-white text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-50"
                >
                  <option value="" disabled>Select…</option>
                  {grades.map(g => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* Language */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">Language</label>
            <select
              value={language}
              onChange={e => setLanguage(e.target.value)}
              className="px-2 py-1.5 rounded-md border border-zinc-200 bg-white text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              <option value="EN">English</option>
              <option value="JP">Japanese</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="px-3 py-1.5 rounded-md bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition-colors cursor-pointer disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={onClose}
              className="px-2 py-1.5 text-sm text-zinc-500 hover:text-zinc-900 cursor-pointer"
            >
              Cancel
            </button>
          </div>

          <Link
            href={`/sell/${listing.id}/edit`}
            className="ml-auto text-xs text-zinc-500 hover:text-orange-600 underline underline-offset-2"
          >
            Full editor (photos)…
          </Link>

          {err && <span className="w-full text-xs text-red-500">{err}</span>}
        </div>
      </td>
    </tr>
  )
}
