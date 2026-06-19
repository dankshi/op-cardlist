'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { GRADING_SCALES, SUBGRADE_KEYS, SUBGRADE_LABEL, SUBGRADE_OPTIONS, type GradingCompany, type CollectionActivityRow } from '@/types/database'
import { gradeLabel } from '@/lib/gradingStyle'
import { Slab } from './Slab'
import type { HoldingRow } from './HoldingsGrid'

function fmtUSD(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/** Black Label is a flawless 10 across all subgrades — no subgrade entry needed. */
const isBlackLabel = (grade: string) => /black\s*label|\bbl\b/i.test(grade)

interface LotDraft { id?: string; quantity: number; price: string; date: string }
type View = 'edit' | 'grading' | 'history' | 'list' | 'regrade' | 'regradeslab' | 'sold'
const COMPANIES: GradingCompany[] = ['PSA', 'BGS', 'CGC', 'TAG']

/** Manage one collection holding from /collection. Everything happens inline in
 *  one modal via a tab switch — Acquisitions (default, since people land here to
 *  edit), History, List for sale, and Got graded — no nested modals/drawers. */
export function ManageHoldingModal({
  row,
  onClose,
  onChanged,
  onLogGrading,
  onAddAnother,
}: {
  row: HoldingRow
  onClose: () => void
  onChanged: () => void
  /** Open the grading-submission builder pre-filled with this holding. */
  onLogGrading?: () => void
  /** Open the add-card modal pinned to this card to add another copy/grade. */
  onAddAnother?: () => void
}) {
  const isGraded = !!(row.gradingCompany && row.grade)
  const [view, setView] = useState<View>('edit')
  const [removing, setRemoving] = useState(false)

  // Acquisitions editor
  const [lots, setLots] = useState<LotDraft[]>([])
  const [loadedLots, setLoadedLots] = useState<LotDraft[]>([])
  const [loadingLots, setLoadingLots] = useState(true)
  const [customValue, setCustomValue] = useState(row.customValue != null ? String(row.customValue) : '')
  const [serial, setSerial] = useState(row.serialNumber ?? '')
  const [cert, setCert] = useState(row.certNumber ?? '')
  // Grading cost is split into a fee + outbound/return shipping (like the
  // submission builder). loadedLotTotal/loadedShip hold what we loaded so the
  // fee can be derived (fee = capitalized total − shipping).
  const [gradingFee, setGradingFee] = useState('')
  const [shipOut, setShipOut] = useState('')
  const [shipRet, setShipRet] = useState('')
  const [loadedLotTotal, setLoadedLotTotal] = useState<number | null>(null)
  const [loadedShip, setLoadedShip] = useState<number | null>(null)
  // The graded date — the grade event's own date, editable from the Grading tab.
  const [gradedDate, setGradedDate] = useState('')
  const [loadedGradedDate, setLoadedGradedDate] = useState('')
  // The grader's submission/order ID for this slab's batch.
  const [submissionLabel, setSubmissionLabel] = useState('')
  const [loadedSubmissionLabel, setLoadedSubmissionLabel] = useState('')
  // Correct a logged grade: the slab's grade + (BGS) subgrades.
  const [editGrade, setEditGrade] = useState(row.grade ?? '')
  const [editSub, setEditSub] = useState<Record<string, string>>(() => {
    const sg = row.subgrades ?? {}
    return Object.fromEntries(SUBGRADE_KEYS.map(k => [k, sg[k] != null ? String(sg[k]) : '']))
  })

  // Re-grade (crossover / bump) — a new logged grade event, distinct from a fix.
  const [rgCompany, setRgCompany] = useState<GradingCompany>((row.gradingCompany as GradingCompany) || 'PSA')
  const [rgGrade, setRgGrade] = useState(row.grade ?? '')
  const [rgCert, setRgCert] = useState('')
  const [rgSub, setRgSub] = useState<Record<string, string>>(() => Object.fromEntries(SUBGRADE_KEYS.map(k => [k, ''])))
  const [rgFee, setRgFee] = useState('')
  const [rgShip, setRgShip] = useState('')
  const [rgSaving, setRgSaving] = useState(false)
  async function submitRegradeSlab() {
    if (rgSaving || !rgGrade || !rgCert.trim()) return
    setRgSaving(true)
    const res = await fetch('/api/collection/adjustments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'regrade_slab', collection_id: row.id, grading_company: rgCompany, grade: rgGrade, cert: rgCert.trim(), subgrades: rgCompany === 'BGS' ? rgSub : null, grading_cost: rgFee === '' ? 0 : Number(rgFee), shipping_cost: rgShip === '' ? 0 : Number(rgShip) }) })
    setRgSaving(false)
    if (res.ok) { onChanged(); onClose() } else { const b = await res.json().catch(() => ({})); alert(b.error || 'Failed to re-grade.') }
  }
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // History
  const [activity, setActivity] = useState<CollectionActivityRow[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)

  // Mark sold (off-platform)
  const [soldPrice, setSoldPrice] = useState(row.marketPrice != null ? row.marketPrice.toFixed(2) : '')
  const [soldFees, setSoldFees] = useState('')
  const [soldDate, setSoldDate] = useState(new Date().toISOString().slice(0, 10))
  const [soldQty, setSoldQty] = useState(1)
  const [soldNote, setSoldNote] = useState('')
  const [selling, setSelling] = useState(false)
  const [soldError, setSoldError] = useState<string | null>(null)
  async function submitSold() {
    if (selling) return
    setSelling(true); setSoldError(null)
    const res = await fetch('/api/collection/sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collection_id: row.id, quantity: soldQty, proceeds: soldPrice === '' ? null : Number(soldPrice), fees: soldFees === '' ? 0 : Number(soldFees), sold_at: soldDate ? new Date(soldDate).toISOString() : undefined, note: soldNote.trim() || null }) })
    setSelling(false)
    if (res.ok) { onChanged(); onClose() } else { const b = await res.json().catch(() => ({})); setSoldError(b.error || 'Failed to record sale.') }
  }

  // List for sale
  const [listPrice, setListPrice] = useState(row.marketPrice != null ? row.marketPrice.toFixed(2) : '')
  const [listQty, setListQty] = useState(1)
  const [listing, setListing] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [listed, setListed] = useState(false)


  const perItem = row.currentValue != null ? row.currentValue / row.quantity : null
  const up = (row.gain ?? 0) >= 0

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  async function loadLots() {
    setLoadingLots(true)
    try {
      const d = await (await fetch(`/api/collection/lots?collection_id=${row.id}`)).json()
      const raw = (d.lots ?? []) as { id: string; quantity: number; price_paid: number | null; acquired_date: string | null; grading_cost: number | null }[]
      const drafts: LotDraft[] = raw.map(l => ({ id: l.id, quantity: l.quantity, price: l.price_paid != null ? String(l.price_paid) : '', date: l.acquired_date ?? '' }))
      const safe = drafts.length ? drafts : [{ quantity: row.quantity || 1, price: '', date: '' }]
      setLots(safe)
      setLoadedLots(safe)
      const gc = raw[0]?.grading_cost
      setLoadedLotTotal(gc != null ? Number(gc) : 0)
    } catch { /* keep */ } finally { setLoadingLots(false) }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadLots() }, [row.id])

  // Pull the slab's grade-event date so the Grading tab can edit it.
  useEffect(() => {
    if (!isGraded) return
    let cancel = false
    ;(async () => {
      try {
        const d = await (await fetch(`/api/collection/activity?collection_id=${encodeURIComponent(row.id)}`)).json()
        const g = (d.activity ?? []).find((a: CollectionActivityRow) => a.kind === 'grade')
        if (!cancel && g) {
          if (g.happened_at) { const ds = new Date(g.happened_at).toISOString().slice(0, 10); setGradedDate(ds); setLoadedGradedDate(ds) }
          setSubmissionLabel(g.submission_label ?? ''); setLoadedSubmissionLabel(g.submission_label ?? '')
          // Event stores combined shipping; show it in the outbound field.
          const sh = g.shipping_cost != null ? Number(g.shipping_cost) : 0
          setShipOut(sh ? String(sh) : ''); setLoadedShip(sh)
        }
      } catch { /* keep */ }
    })()
    return () => { cancel = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id])

  // Derive the editable grading fee once both loads land: fee = total − shipping.
  useEffect(() => {
    if (loadedLotTotal == null) return
    const fee = Math.max(0, loadedLotTotal - (loadedShip ?? 0))
    setGradingFee(fee ? String(Math.round(fee * 100) / 100) : '')
  }, [loadedLotTotal, loadedShip])

  async function loadHistory() {
    setLoadingHistory(true)
    try {
      // Scope to THIS line so a single slab shows only its own acquisition +
      // grade + sales — not every copy's NM purchase that shares the card id.
      const d = await (await fetch(`/api/collection/activity?collection_id=${encodeURIComponent(row.id)}`)).json()
      setActivity(d.activity ?? [])
      setHistoryLoaded(true)
    } finally { setLoadingHistory(false) }
  }
  function openHistory() { setView('history'); if (!historyLoaded) loadHistory() }

  function updateLot(i: number, patch: Partial<LotDraft>) { setLots(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l)); setEditError(null) }
  function addLot() { setLots(prev => [...prev, { quantity: 1, price: '', date: new Date().toISOString().slice(0, 10) }]) }
  function removeLot(i: number) { setLots(prev => prev.filter((_, idx) => idx !== i)) }

  async function saveEdit() {
    if (savingEdit) return
    setSavingEdit(true); setEditError(null)
    // Grading cost = fee + outbound + return shipping; capitalized total goes to
    // the lot, fee/shipping split goes to the grade event.
    const shipTotal = Math.round(((shipOut === '' ? 0 : Number(shipOut)) + (shipRet === '' ? 0 : Number(shipRet))) * 100) / 100
    const gradingTotal = Math.round(((gradingFee === '' ? 0 : Number(gradingFee)) + shipTotal) * 100) / 100
    try {
      const v = await fetch('/api/collection', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: row.id, custom_value: customValue || null, serial_number: serial || null, cert_number: isGraded ? (cert || null) : null, ...(isGraded ? { grade: editGrade } : {}), ...(isGraded && row.gradingCompany === 'BGS' ? { subgrades: isBlackLabel(editGrade) ? null : editSub } : {}), ...(isGraded && gradedDate && gradedDate !== loadedGradedDate ? { graded_at: gradedDate } : {}), ...(isGraded && submissionLabel !== loadedSubmissionLabel ? { submission_label: submissionLabel.trim() || null } : {}), ...(isGraded ? { grading_cost: gradingTotal, shipping_cost: shipTotal } : {}) }) })
      if (!v.ok) { setEditError('Couldn’t save.'); return }
      const seen = new Set<string>()
      for (const lot of lots) {
        if (lot.id) {
          seen.add(lot.id)
          const orig = loadedLots.find(l => l.id === lot.id)
          if (orig && orig.quantity === lot.quantity && orig.price === lot.price && orig.date === lot.date) continue
          const r = await fetch('/api/collection/lots', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: lot.id, quantity: lot.quantity, price_paid: lot.price, acquired_date: lot.date || null }) })
          if (!r.ok) { setEditError('Couldn’t save an acquisition.'); return }
        } else {
          const r = await fetch('/api/collection/lots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collection_id: row.id, quantity: lot.quantity, price_paid: lot.price, acquired_date: lot.date || null }) })
          if (!r.ok) { setEditError('Couldn’t save an acquisition.'); return }
        }
      }
      for (const orig of loadedLots) {
        if (orig.id && !seen.has(orig.id)) {
          const r = await fetch(`/api/collection/lots?id=${orig.id}`, { method: 'DELETE' })
          if (!r.ok) { setEditError('Couldn’t remove an acquisition.'); return }
        }
      }
      // Capitalize the full grading cost (fee + shipping) onto the first lot.
      if (isGraded) {
        const d = await (await fetch(`/api/collection/lots?collection_id=${row.id}`)).json()
        const firstId = d.lots?.[0]?.id
        if (firstId) await fetch('/api/collection/lots', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: firstId, grading_cost: gradingTotal }) }).catch(() => {})
      }
      onChanged()
      // One save, then we're done — close out so there's a single, obvious action.
      onClose()
    } finally { setSavingEdit(false) }
  }

  async function submitList() {
    const price = Number(listPrice)
    if (!Number.isFinite(price) || price <= 0) { setListError('Enter a price'); return }
    setListing(true); setListError(null)
    const title = `${row.cardName}${isGraded ? ` (${row.gradingCompany} ${row.grade})` : ' (NM)'}`
    const res = await fetch('/api/listings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ card_id: row.cardId, title, price, condition: 'near_mint', quantity: listQty, language: 'EN', is_first_edition: false, photo_urls: [], grading_company: row.gradingCompany, grade: row.grade, collection_id: row.id }) })
    setListing(false)
    if (res.ok) { setListed(true); onChanged() }
    else { const b = await res.json().catch(() => ({})); setListError(b.error || 'Failed to list. You may need to finish seller setup.') }
  }

  async function remove(force = false) {
    if (removing) return
    const msg = force
      ? 'Force-remove and ERASE this card and its history? This cannot be undone.'
      : 'Remove this card? Use this only if you added it by mistake — if you sold it, use “Mark sold” so the history + profit are kept.'
    if (!confirm(msg)) return
    setRemoving(true)
    const res = await fetch(`/api/collection?id=${row.id}${force ? '&force=1' : ''}`, { method: 'DELETE' })
    setRemoving(false)
    if (res.ok) { onChanged(); onClose(); return }
    const b = await res.json().catch(() => ({}))
    if (b.hasHistory && !force) {
      if (confirm(`${b.error}\n\nErase it and its history anyway?`)) return remove(true)
      return
    }
    alert(b.error || 'Failed to remove.')
  }

  const field = 'w-full px-3 py-2 rounded-lg border border-zinc-300 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-orange-500 disabled:opacity-50'
  const tabs: { v: View; label: string }[] = [
    { v: 'edit', label: 'Acquisitions' },
    ...(isGraded ? [{ v: 'grading' as View, label: 'Grading' }] : []),
    { v: 'history', label: 'History' },
    { v: 'list', label: 'List' },
    { v: 'sold', label: 'Mark sold' },
    ...(!isGraded ? [{ v: 'regrade' as View, label: 'Got graded' }] : [{ v: 'regradeslab' as View, label: 'Re-grade' }]),
  ]
  const realizedTotal = activity.filter(a => a.kind === 'sell' && a.realized != null).reduce((s, a) => s + Number(a.realized), 0)

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-4 py-8" onClick={onClose} role="dialog" aria-modal="true">
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start gap-3 px-6 pt-5 pb-4 border-b border-zinc-100">
          <div className="w-14 flex-shrink-0">
            {isGraded
              ? <Slab imageUrl={row.imageUrl} cardName={row.cardName} company={row.gradingCompany!} grade={row.grade!} certNumber={row.certNumber} subgrades={row.subgrades} setName={row.setName} cardId={row.cardId} rarity={row.rarity} setYear={row.setYear} artStyle={row.artStyle} />
              : (
                <div className="relative aspect-[5/7] rounded-md overflow-hidden bg-zinc-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {row.imageUrl && <img src={row.imageUrl} alt={row.cardName} className="absolute inset-0 w-full h-full object-cover" />}
                </div>
              )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-zinc-900 leading-tight line-clamp-2">{row.cardName}</h2>
            <p className="text-[11px] text-zinc-400 truncate mt-0.5">{[row.rarity, row.cardId, gradeLabel(row.gradingCompany, row.grade)].filter(Boolean).join(' · ')}</p>
            <div className="flex items-center gap-3 mt-1">
              <Link href={`/card/${row.cardId.toLowerCase()}`} className="text-[11px] font-semibold text-orange-600 hover:text-orange-700 inline-block">View on marketplace →</Link>
              {onAddAnother && (
                <button type="button" onClick={() => { onClose(); onAddAnother() }} className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-0.5 cursor-pointer">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                  Add another
                </button>
              )}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex-shrink-0 w-8 h-8 inline-flex items-center justify-center rounded-full text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 cursor-pointer">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Summary */}
        <div className="px-6 py-4 border-b border-zinc-100 flex items-end justify-between gap-3">
          <div>
            <p className="text-2xl font-bold tabular-nums leading-none flex items-center gap-1.5">
              <span className={row.customValue != null ? 'text-amber-600' : 'text-zinc-900'}>{perItem != null ? fmtUSD(perItem) : '—'}</span>
              <span className="text-xs font-medium text-zinc-400">/ea</span>
              {row.customValue != null && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide text-amber-700 bg-amber-100 ring-1 ring-amber-200">
                  <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>
                  Set value
                </span>
              )}
            </p>
            <p className="text-[11px] text-zinc-500 tabular-nums mt-1">{row.acquiredPrice != null ? `Avg ${fmtUSD(row.acquiredPrice)} ea` : 'No cost basis'}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold tabular-nums text-zinc-900">×{row.quantity}{row.currentValue != null ? ` = ${fmtUSD(row.currentValue)}` : ''}</p>
            {row.gain != null && (
              <p className={`text-[11px] font-semibold tabular-nums mt-0.5 ${up ? 'text-emerald-600' : 'text-red-600'}`}>{up ? '+' : '−'}{fmtUSD(Math.abs(row.gain))}{row.gainPct != null ? ` (${(Math.abs(row.gainPct) * 100).toFixed(1)}%)` : ''}</p>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-4 pt-3">
          {tabs.map(t => (
            <button
              key={t.v}
              type="button"
              onClick={() => t.v === 'history' ? openHistory() : setView(t.v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${view === t.v ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="px-6 py-4 min-h-[180px]">
          {view === 'edit' && (
            loadingLots ? <div className="py-10 text-center"><div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" /></div> : (
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">Acquisitions</p>
                  <div className="space-y-2">
                    {lots.map((lot, i) => (
                      <div key={lot.id ?? `n-${i}`} className="flex items-center gap-2 rounded-lg ring-1 ring-zinc-200 p-2">
                        <div className="inline-flex items-center rounded-md ring-1 ring-zinc-200 overflow-hidden flex-shrink-0">
                          <button type="button" onClick={() => updateLot(i, { quantity: Math.max(1, lot.quantity - 1) })} disabled={lot.quantity <= 1} className="px-2 py-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 cursor-pointer">−</button>
                          <input type="text" inputMode="numeric" value={lot.quantity} onFocus={e => e.currentTarget.select()} onChange={e => { const n = parseInt(e.target.value.replace(/\D/g, ''), 10); updateLot(i, { quantity: Number.isFinite(n) && n >= 1 ? n : 1 }) }} className="w-9 py-1 text-xs font-bold tabular-nums text-zinc-700 text-center border-x border-zinc-200 focus:outline-none focus:bg-orange-50" />
                          <button type="button" onClick={() => updateLot(i, { quantity: lot.quantity + 1 })} className="px-2 py-1 text-zinc-500 hover:bg-zinc-100 cursor-pointer">+</button>
                        </div>
                        <div className="relative flex-1 min-w-0">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm font-bold text-zinc-400">$</span>
                          <input type="number" step="0.01" min="0" value={lot.price} placeholder="Price ea" onChange={e => updateLot(i, { price: e.target.value })} className="w-full pl-6 pr-2 py-1.5 rounded-md border border-zinc-200 text-sm tabular-nums text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-orange-500" />
                        </div>
                        <input type="date" value={lot.date} onChange={e => updateLot(i, { date: e.target.value })} className="flex-shrink-0 w-[8.5rem] px-2 py-1.5 rounded-md border border-zinc-200 text-xs text-zinc-900 focus:outline-none focus:border-orange-500" />
                        <button type="button" onClick={() => removeLot(i)} disabled={lots.length <= 1} title={lots.length <= 1 ? 'Use Remove to delete the card' : 'Remove acquisition'} className="flex-shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-md text-zinc-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30 cursor-pointer disabled:cursor-default">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    ))}
                    <button type="button" onClick={addLot} className="inline-flex items-center gap-1 text-xs font-semibold text-orange-600 hover:text-orange-700 cursor-pointer">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                      Add acquisition
                    </button>
                  </div>
                </div>

                {/* For a slab, Acquisitions stays simple — just the slab's IDs.
                    Grade, subgrades, graded date + cost live on the Grading tab. */}
                {isGraded ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] uppercase tracking-wide text-zinc-500 font-semibold mb-1">Serial</label>
                      <input type="text" value={serial} onChange={e => setSerial(e.target.value)} placeholder="012/100" className={field} />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase tracking-wide text-zinc-500 font-semibold mb-1">Cert number</label>
                      <input type="text" inputMode="numeric" value={cert} onChange={e => setCert(e.target.value)} placeholder="0011590232" className={`${field} tabular-nums`} />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] uppercase tracking-wide text-zinc-500 font-semibold mb-1">Value override /ea</label>
                      <div className="relative"><span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-400">$</span>
                        <input type="number" step="0.01" min="0" value={customValue} onChange={e => setCustomValue(e.target.value)} placeholder="Market" className={`${field} pl-6 tabular-nums`} />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase tracking-wide text-zinc-500 font-semibold mb-1">Serial</label>
                      <input type="text" value={serial} onChange={e => setSerial(e.target.value)} placeholder="012/100" className={field} />
                    </div>
                  </div>
                )}

                {editError && <p className="text-xs text-red-600">{editError}</p>}
              </div>
            )
          )}

          {view === 'grading' && isGraded && (
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] uppercase tracking-wide text-zinc-500 font-semibold mb-1">Grade</label>
                <select value={editGrade} onChange={e => setEditGrade(e.target.value)} className={field}>{(GRADING_SCALES[row.gradingCompany as GradingCompany] ?? []).map(g => <option key={g} value={g}>{g}</option>)}</select>
              </div>
              {row.gradingCompany === 'BGS' && !isBlackLabel(editGrade) && (
                <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
                  {SUBGRADE_KEYS.map(k => (
                    <div key={k} className="flex items-center gap-1.5">
                      <label className="text-[10px] uppercase tracking-wide text-zinc-500 font-semibold w-16 flex-shrink-0">{SUBGRADE_LABEL[k]}</label>
                      <select value={editSub[k]} onChange={e => setEditSub(prev => ({ ...prev, [k]: e.target.value }))} className="flex-1 min-w-0 px-2 py-1.5 rounded-md border border-zinc-300 bg-white text-xs tabular-nums text-zinc-900 focus:outline-none focus:border-orange-500">{SUBGRADE_OPTIONS.map(g => <option key={g} value={g}>{g || '—'}</option>)}</select>
                    </div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] uppercase tracking-wide text-zinc-500 font-semibold mb-1">Graded date</label>
                  <input type="date" value={gradedDate} onChange={e => setGradedDate(e.target.value)} className={field} />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wide text-zinc-500 font-semibold mb-1">Grading fee</label>
                  <div className="relative"><span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-400">$</span>
                    <input type="number" step="0.01" min="0" value={gradingFee} onChange={e => setGradingFee(e.target.value)} placeholder="Fee" className={`${field} pl-6 tabular-nums`} />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] uppercase tracking-wide text-zinc-500 font-semibold mb-1">Submission shipping <span className="text-zinc-400 normal-case font-normal">(to grader)</span></label>
                  <div className="relative"><span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-400">$</span>
                    <input type="number" step="0.01" min="0" value={shipOut} onChange={e => setShipOut(e.target.value)} placeholder="Outbound" className={`${field} pl-6 tabular-nums`} />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wide text-zinc-500 font-semibold mb-1">Return shipping <span className="text-zinc-400 normal-case font-normal">(back to you)</span></label>
                  <div className="relative"><span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-400">$</span>
                    <input type="number" step="0.01" min="0" value={shipRet} onChange={e => setShipRet(e.target.value)} placeholder="Return" className={`${field} pl-6 tabular-nums`} />
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wide text-zinc-500 font-semibold mb-1">Submission ID <span className="text-zinc-400 normal-case font-normal">(opt)</span></label>
                <input type="text" value={submissionLabel} onChange={e => setSubmissionLabel(e.target.value)} placeholder="e.g. BGS order #1234567" className={field} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wide text-zinc-500 font-semibold mb-1">Value override /ea <span className="text-zinc-400 normal-case font-normal">(opt)</span></label>
                <div className="relative"><span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-400">$</span>
                  <input type="number" step="0.01" min="0" value={customValue} onChange={e => setCustomValue(e.target.value)} placeholder="Market" className={`${field} pl-6 tabular-nums`} />
                </div>
              </div>
              {editError && <p className="text-xs text-red-600">{editError}</p>}
            </div>
          )}

          {view === 'history' && (
            loadingHistory ? <div className="py-10 text-center"><div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" /></div> : activity.length === 0 ? (
              <p className="text-sm text-zinc-500 text-center py-8">No activity yet.</p>
            ) : (
              <>
                {Math.abs(realizedTotal) >= 0.005 && (
                  <p className="text-xs tabular-nums text-right mb-2"><span className="text-zinc-400">Realized </span><span className={`font-semibold ${realizedTotal >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{realizedTotal >= 0 ? '+' : '−'}{fmtUSD(Math.abs(realizedTotal))}</span></p>
                )}
                <ol className="relative border-l border-zinc-200 ml-1.5 space-y-4 max-h-[40vh] overflow-y-auto pr-1">
                  {activity.map(a => {
                    const qty = a.quantity ?? 1
                    const realized = a.realized != null ? Number(a.realized) : null
                    return (
                      <li key={`${a.kind}-${a.source_id}`} className="ml-4">
                        <span className={`absolute -left-[5px] w-2.5 h-2.5 rounded-full ${a.kind === 'sell' ? 'bg-emerald-500' : a.kind === 'grade' ? 'bg-purple-500' : 'bg-zinc-400'}`} />
                        <div className="flex items-baseline justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-zinc-900">
                              {a.kind === 'buy' ? `Bought ×${qty}` : a.kind === 'sell' ? `Sold ×${qty}` : a.kind === 'grade' ? `Graded ${a.from_grade ?? ''} → ${a.to_grade ?? ''}` : (a.note ?? 'Adjustment')}
                            </p>
                            <p className="text-[11px] text-zinc-400">{fmtDate(a.happened_at)}{a.kind === 'sell' ? ` · ${a.ref_order_id ? 'Nomi' : 'Manual'}` : ''}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm tabular-nums text-zinc-900">{a.amount != null ? fmtUSD(Number(a.amount)) : '—'}</p>
                            {realized != null && <p className={`text-[11px] font-semibold tabular-nums ${realized >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{realized >= 0 ? '+' : '−'}{fmtUSD(Math.abs(realized))}</p>}
                            {a.kind === 'grade' && a.shipping_cost != null && Number(a.shipping_cost) > 0 && (
                              <p className="text-[10px] text-zinc-400 tabular-nums">incl. {fmtUSD(Number(a.shipping_cost))} ship</p>
                            )}
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ol>
              </>
            )
          )}

          {view === 'list' && (
            listed ? (
              <p className="text-sm text-emerald-700 font-semibold py-4">Listed ✓ <Link href="/sellerhub" className="underline">Manage in seller hub →</Link></p>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-zinc-500">List {isGraded ? gradeLabel(row.gradingCompany, row.grade) : 'this card'} on the marketplace.</p>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="block text-[10px] uppercase tracking-wide text-zinc-500 font-semibold mb-1">Price /ea</label>
                    <div className="relative"><span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-400">$</span>
                      <input type="number" min="0" step="0.01" value={listPrice} onChange={e => { setListPrice(e.target.value); setListError(null) }} className={`${field} pl-6 tabular-nums`} />
                    </div>
                  </div>
                  <div className="w-20">
                    <label className="block text-[10px] uppercase tracking-wide text-zinc-500 font-semibold mb-1">Qty</label>
                    <input type="number" min={1} max={row.quantity} value={listQty} onChange={e => setListQty(Math.max(1, Math.min(row.quantity, parseInt(e.target.value) || 1)))} className={`${field} tabular-nums`} />
                  </div>
                  <button type="button" onClick={submitList} disabled={listing} className="px-4 py-2 rounded-lg text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer disabled:opacity-50 whitespace-nowrap">{listing ? 'Listing…' : 'List'}</button>
                </div>
                {listError && <p className="text-[11px] text-red-600">{listError}</p>}
              </div>
            )
          )}

          {view === 'sold' && (
            <div className="space-y-3">
              <p className="text-xs text-zinc-500">Record an off-platform sale (eBay, in person…). Keeps the card in your history with realized P&amp;L and removes it from holdings — use this instead of Remove when you sold it.</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] uppercase tracking-wide text-zinc-500 font-semibold mb-1">Sale price /ea</label>
                  <div className="relative"><span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-400">$</span><input type="number" min="0" step="0.01" value={soldPrice} onChange={e => { setSoldPrice(e.target.value); setSoldError(null) }} placeholder="Proceeds" className={`${field} pl-6 tabular-nums`} /></div>
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wide text-zinc-500 font-semibold mb-1">Fees <span className="text-zinc-400 normal-case font-normal">(opt)</span></label>
                  <div className="relative"><span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-400">$</span><input type="number" min="0" step="0.01" value={soldFees} onChange={e => setSoldFees(e.target.value)} placeholder="Fees" className={`${field} pl-6 tabular-nums`} /></div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] uppercase tracking-wide text-zinc-500 font-semibold mb-1">Date sold</label>
                  <input type="date" value={soldDate} onChange={e => setSoldDate(e.target.value)} className={field} />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wide text-zinc-500 font-semibold mb-1">Qty</label>
                  <input type="number" min={1} max={row.quantity} value={soldQty} onChange={e => setSoldQty(Math.max(1, Math.min(row.quantity, parseInt(e.target.value) || 1)))} className={`${field} tabular-nums`} />
                </div>
              </div>
              <input type="text" value={soldNote} onChange={e => setSoldNote(e.target.value)} placeholder="Note (optional) — buyer, platform…" className={field} />
              {Number(soldPrice) > 0 && row.acquiredPrice != null && (() => {
                const net = Number(soldPrice) * soldQty - (Number(soldFees) || 0)
                const r = net - row.acquiredPrice! * soldQty
                return <p className="text-[11px] text-zinc-500 tabular-nums">Net {fmtUSD(net)} · realized <span className={`font-semibold ${r >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{r >= 0 ? '+' : '−'}{fmtUSD(Math.abs(r))}</span></p>
              })()}
              {soldError && <p className="text-xs text-red-600">{soldError}</p>}
              <div className="flex justify-end">
                <button type="button" onClick={submitSold} disabled={selling} className="px-4 py-2 rounded-lg text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer disabled:opacity-50">{selling ? 'Saving…' : 'Record sale'}</button>
              </div>
            </div>
          )}

          {view === 'regrade' && !isGraded && (
            <div className="space-y-3">
              <p className="text-xs text-zinc-500">Got these back from a grader? Log a grading submission — each card becomes its own slab with its own grade + cert, and the grading fees + shipping fold into cost basis. You can add other cards from the same submission too.</p>
              <div className="flex justify-end">
                <button type="button" onClick={() => onLogGrading?.()} disabled={!onLogGrading} className="px-4 py-2 rounded-lg text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer disabled:opacity-50">Log grading submission →</button>
              </div>
            </div>
          )}

          {view === 'regradeslab' && isGraded && (
            <div className="space-y-3">
              <p className="text-xs text-zinc-500">Crossover or a new grade on resubmit — logs a new event ({gradeLabel(row.gradingCompany, row.grade)} → new) and adds the cost to basis. To fix a typo instead, use the Acquisitions tab.</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] uppercase tracking-wide text-zinc-500 font-semibold mb-1">New company</label>
                  <select value={rgCompany} onChange={e => { const c = e.target.value as GradingCompany; setRgCompany(c); setRgGrade(GRADING_SCALES[c][0]) }} className={field}>{COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}</select>
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wide text-zinc-500 font-semibold mb-1">New grade</label>
                  <select value={rgGrade} onChange={e => setRgGrade(e.target.value)} className={field}>{GRADING_SCALES[rgCompany].map(g => <option key={g} value={g}>{g}</option>)}</select>
                </div>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wide text-zinc-500 font-semibold mb-1">New cert # (required)</label>
                <input type="text" inputMode="numeric" value={rgCert} onChange={e => setRgCert(e.target.value)} placeholder="Cert #" className={`${field} tabular-nums ${rgCert.trim() ? '' : 'border-red-300'}`} />
              </div>
              {rgCompany === 'BGS' && (
                <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
                  {SUBGRADE_KEYS.map(k => (
                    <div key={k} className="flex items-center gap-1.5">
                      <label className="text-[10px] uppercase tracking-wide text-zinc-500 font-semibold w-16 flex-shrink-0">{SUBGRADE_LABEL[k]}</label>
                      <select value={rgSub[k]} onChange={e => setRgSub(prev => ({ ...prev, [k]: e.target.value }))} className="flex-1 min-w-0 px-2 py-1.5 rounded-md border border-zinc-300 bg-white text-xs tabular-nums text-zinc-900 focus:outline-none focus:border-orange-500">{SUBGRADE_OPTIONS.map(g => <option key={g} value={g}>{g || '—'}</option>)}</select>
                    </div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] uppercase tracking-wide text-zinc-500 font-semibold mb-1">Re-grade fee</label>
                  <div className="relative"><span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-400">$</span><input type="number" min="0" step="0.01" value={rgFee} onChange={e => setRgFee(e.target.value)} placeholder="Fee" className={`${field} pl-6 tabular-nums`} /></div>
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wide text-zinc-500 font-semibold mb-1">Shipping <span className="text-zinc-400 normal-case font-normal">(opt)</span></label>
                  <div className="relative"><span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-400">$</span><input type="number" min="0" step="0.01" value={rgShip} onChange={e => setRgShip(e.target.value)} placeholder="Ship" className={`${field} pl-6 tabular-nums`} /></div>
                </div>
              </div>
              <div className="flex justify-end">
                <button type="button" onClick={submitRegradeSlab} disabled={rgSaving || !rgCert.trim()} className="px-4 py-2 rounded-lg text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer disabled:opacity-50">{rgSaving ? 'Saving…' : 'Re-grade'}</button>
              </div>
            </div>
          )}
        </div>

        {/* Footer — one primary action. On the Acquisitions tab it saves
            everything and closes; other tabs have their own action button, so
            here it just dismisses. */}
        <div className="flex items-center px-6 py-4 border-t border-zinc-100 bg-zinc-50/50 rounded-b-2xl">
          <button type="button" onClick={() => remove()} disabled={removing} title="Only for cards added by mistake — to record a sale use Mark sold" className="px-3 py-2 rounded-lg text-sm font-semibold text-red-600 hover:bg-red-50 cursor-pointer disabled:opacity-50">{removing ? 'Removing…' : 'Remove'}</button>
          <div className="flex-1" />
          {view === 'edit' || view === 'grading' ? (
            <button type="button" onClick={saveEdit} disabled={savingEdit} className="px-5 py-2 rounded-lg text-sm font-bold bg-orange-500 hover:bg-orange-600 text-white cursor-pointer disabled:opacity-50">{savingEdit ? 'Saving…' : 'Save changes'}</button>
          ) : (
            <button type="button" onClick={onClose} className="px-5 py-2 rounded-lg text-sm font-bold bg-zinc-900 hover:bg-zinc-800 text-white cursor-pointer">Done</button>
          )}
        </div>
      </div>
    </div>
  )
}
