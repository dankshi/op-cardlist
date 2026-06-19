'use client'

import { useEffect, useMemo, useState } from 'react'
import { GRADING_SCALES, SUBGRADE_KEYS, SUBGRADE_LABEL, SUBGRADE_OPTIONS, type SubgradeKey, type GradingCompany } from '@/types/database'
import type { HoldingRow } from './HoldingsGrid'

const COMPANIES: GradingCompany[] = ['PSA', 'BGS', 'CGC', 'TAG']

function fmtUSD(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** One copy in the submission. `holdingId` is the source raw collection line;
 *  `lotId` optionally pins WHICH acquisition's basis the slab inherits. */
interface Item { holdingId: string; grade: string; cert: string; fee: string; subgrades: Record<SubgradeKey, string>; lotId: string }
interface Lot { id: string; quantity: number; price_paid: number | null; acquired_date: string | null }

function emptySubgrades(): Record<SubgradeKey, string> {
  return { centering: '', corners: '', edges: '', surface: '' }
}

/** Log a grading submission: a batch of individual copies — different cards or a
 *  subset of a holding — sent to one grader together. Each gets its own grade +
 *  cert + grading fee; outbound + return shipping are one cost for the batch,
 *  split evenly and capitalized into each slab's basis. */
export function GradingSubmissionModal({
  open,
  onClose,
  onSaved,
  rawHoldings,
  preset,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
  /** Raw (ungraded) holdings the user can submit, with available quantity. */
  rawHoldings: HoldingRow[]
  /** Pre-add one copy of this holding (the per-card "Got graded" shortcut). */
  preset?: HoldingRow | null
}) {
  const [company, setCompany] = useState<GradingCompany>('PSA')
  const [items, setItems] = useState<Item[]>([])
  const [lotsByHolding, setLotsByHolding] = useState<Map<string, Lot[]>>(new Map())
  const [outbound, setOutbound] = useState('')
  const [ret, setRet] = useState('')
  const [picker, setPicker] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const holdingById = useMemo(() => new Map(rawHoldings.map(h => [h.id, h])), [rawHoldings])

  // Reset + seed on open.
  useEffect(() => {
    if (!open) return
    setCompany('PSA')
    setOutbound(''); setRet(''); setPicker(''); setError(null); setSubmitting(false)
    setLotsByHolding(new Map())
    setItems(preset ? [{ holdingId: preset.id, grade: GRADING_SCALES.PSA[0], cert: '', fee: '', subgrades: emptySubgrades(), lotId: '' }] : [])
  }, [open, preset?.id])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !submitting) onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, onClose, submitting])

  // Available copies per holding = owned raw qty minus copies already in the batch.
  const usedByHolding = useMemo(() => {
    const m = new Map<string, number>()
    for (const it of items) m.set(it.holdingId, (m.get(it.holdingId) ?? 0) + 1)
    return m
  }, [items])
  const addable = rawHoldings.filter(h => h.quantity - (usedByHolding.get(h.id) ?? 0) > 0)

  if (!open) return null

  async function addItem(holdingId: string) {
    if (!holdingId) return
    setPicker('')
    setError(null)
    // Load the card's acquisitions so we can pin which one becomes this slab.
    let lots = lotsByHolding.get(holdingId)
    if (!lots) {
      try {
        const d = await (await fetch(`/api/collection/lots?collection_id=${holdingId}`)).json()
        lots = ((d.lots ?? []) as Lot[]).map(l => ({ id: l.id, quantity: l.quantity, price_paid: l.price_paid, acquired_date: l.acquired_date }))
        setLotsByHolding(prev => new Map(prev).set(holdingId, lots!))
      } catch { lots = [] }
    }
    // Default to the oldest acquisition when there's a choice (lots arrive oldest-first).
    const lotId = lots.length > 1 ? lots[0].id : ''
    setItems(prev => [...prev, { holdingId, grade: GRADING_SCALES[company][0], cert: '', fee: '', subgrades: emptySubgrades(), lotId }])
  }
  function updateItem(i: number, patch: Partial<Item>) {
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...patch } : it))
  }
  function updateSub(i: number, key: SubgradeKey, val: string) {
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, subgrades: { ...it.subgrades, [key]: val } } : it))
  }
  function removeItem(i: number) { setItems(prev => prev.filter((_, idx) => idx !== i)) }

  const feeTotal = items.reduce((s, it) => s + (Number(it.fee) || 0), 0)
  const shipTotal = (Number(outbound) || 0) + (Number(ret) || 0)
  const grandTotal = feeTotal + shipTotal
  const perCardShip = items.length ? shipTotal / items.length : 0
  const canSubmit = items.length > 0 && items.every(it => it.grade && it.cert.trim())

  async function submit() {
    if (!canSubmit || submitting) return
    setSubmitting(true); setError(null)
    try {
      const res = await fetch('/api/collection/adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'grade_submission',
          grading_company: company,
          items: items.map(it => ({ collection_id: it.holdingId, grade: it.grade, cert: it.cert.trim(), grading_fee: it.fee === '' ? 0 : Number(it.fee), subgrades: company === 'BGS' ? it.subgrades : null, lot_id: it.lotId || null })),
          outbound_shipping: outbound === '' ? 0 : Number(outbound),
          return_shipping: ret === '' ? 0 : Number(ret),
        }),
      })
      if (!res.ok) { const b = await res.json().catch(() => ({})); setError(b.error || 'Failed to record submission.'); return }
      onSaved(); onClose()
    } finally { setSubmitting(false) }
  }

  const field = 'px-3 py-2 rounded-lg border border-zinc-300 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-orange-500 disabled:opacity-50'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-4 py-8" onClick={() => { if (!submitting) onClose() }} role="dialog" aria-modal="true">
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-zinc-100">
          <div>
            <h2 className="text-lg font-bold text-zinc-900">Log a grading submission</h2>
            <p className="text-[11px] text-zinc-500 mt-0.5">Each card becomes its own slab. Shipping is split evenly across the batch and folds into cost basis.</p>
          </div>
          <button onClick={onClose} disabled={submitting} aria-label="Close" className="flex-shrink-0 w-8 h-8 inline-flex items-center justify-center rounded-full text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 cursor-pointer disabled:opacity-50">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-zinc-500 font-semibold mb-1">Grading company</label>
            <select value={company} onChange={e => { const c = e.target.value as GradingCompany; setCompany(c); setItems(prev => prev.map(it => ({ ...it, grade: GRADING_SCALES[c][0] }))) }} className={`${field} w-full`}>
              {COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Cards in the submission */}
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-wide text-zinc-500 font-semibold">Cards ({items.length})</p>
            {items.length === 0 && <p className="text-xs text-zinc-400">No cards yet — add one below.</p>}
            {items.map((it, i) => {
              const h = holdingById.get(it.holdingId)
              return (
                <div key={i} className="rounded-lg ring-1 ring-zinc-200 p-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-zinc-800 truncate">{h?.cardName ?? 'Card'} <span className="text-zinc-400 font-mono font-normal">{h?.cardId}</span></p>
                    <button type="button" onClick={() => removeItem(i)} aria-label="Remove" className="flex-shrink-0 w-6 h-6 inline-flex items-center justify-center rounded text-zinc-400 hover:text-red-600 hover:bg-red-50 cursor-pointer">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <select value={it.grade} onChange={e => updateItem(i, { grade: e.target.value })} className="w-[4.5rem] flex-shrink-0 px-2 py-2 rounded-lg border border-zinc-300 bg-white text-sm text-zinc-900 focus:outline-none focus:border-orange-500">{GRADING_SCALES[company].map(g => <option key={g} value={g}>{g}</option>)}</select>
                    <input type="text" inputMode="numeric" value={it.cert} onChange={e => updateItem(i, { cert: e.target.value })} placeholder="Cert # (required)" className={`flex-1 min-w-0 px-3 py-2 rounded-lg border text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none tabular-nums ${it.cert.trim() ? 'border-zinc-300 focus:border-orange-500' : 'border-red-300 focus:border-red-500'}`} />
                    <div className="relative w-24 flex-shrink-0"><span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-400">$</span><input type="number" min="0" step="0.01" value={it.fee} onChange={e => updateItem(i, { fee: e.target.value })} placeholder="Fee" className={`${field} w-full pl-6 tabular-nums`} /></div>
                  </div>
                  {(lotsByHolding.get(it.holdingId)?.length ?? 0) > 1 && (
                    <div className="flex items-center gap-1.5">
                      <label className="text-[10px] uppercase tracking-wide text-zinc-500 font-semibold flex-shrink-0">From buy</label>
                      <select value={it.lotId} onChange={e => updateItem(i, { lotId: e.target.value })} className="flex-1 min-w-0 px-2 py-1.5 rounded-md border border-zinc-300 bg-white text-xs tabular-nums text-zinc-900 focus:outline-none focus:border-orange-500">
                        {(lotsByHolding.get(it.holdingId) ?? []).map(l => <option key={l.id} value={l.id}>{l.price_paid != null ? fmtUSD(Number(l.price_paid)) : 'no cost'}{l.acquired_date ? ` · ${l.acquired_date}` : ''}{l.quantity > 1 ? ` (×${l.quantity})` : ''}</option>)}
                      </select>
                    </div>
                  )}
                  {company === 'BGS' && (
                    <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
                      {SUBGRADE_KEYS.map(k => (
                        <div key={k} className="flex items-center gap-1.5">
                          <label className="text-[10px] uppercase tracking-wide text-zinc-500 font-semibold w-16 flex-shrink-0">{SUBGRADE_LABEL[k]}</label>
                          <select value={it.subgrades[k]} onChange={e => updateSub(i, k, e.target.value)} className="flex-1 min-w-0 px-2 py-1.5 rounded-md border border-zinc-300 bg-white text-xs tabular-nums text-zinc-900 focus:outline-none focus:border-orange-500">{SUBGRADE_OPTIONS.map(g => <option key={g} value={g}>{g || '—'}</option>)}</select>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}

            {addable.length > 0 ? (
              <select value={picker} onChange={e => addItem(e.target.value)} className={`${field} w-full text-zinc-600`}>
                <option value="">+ Add a card…</option>
                {addable.map(h => {
                  const left = h.quantity - (usedByHolding.get(h.id) ?? 0)
                  return <option key={h.id} value={h.id}>{h.cardName} ({h.cardId}) — {left} raw left</option>
                })}
              </select>
            ) : (
              <p className="text-[11px] text-zinc-400">{rawHoldings.length === 0 ? 'No raw cards to grade.' : 'All raw copies are in the batch.'}</p>
            )}
          </div>

          {/* Shipping — one cost for the whole batch */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] uppercase tracking-wide text-zinc-500 font-semibold mb-1">Submission shipping <span className="text-zinc-400 normal-case font-normal">(to grader)</span></label>
              <div className="relative"><span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-400">$</span><input type="number" min="0" step="0.01" value={outbound} onChange={e => setOutbound(e.target.value)} placeholder="Outbound" className={`${field} w-full pl-6 tabular-nums`} /></div>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wide text-zinc-500 font-semibold mb-1">Return shipping <span className="text-zinc-400 normal-case font-normal">(back to you)</span></label>
              <div className="relative"><span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-400">$</span><input type="number" min="0" step="0.01" value={ret} onChange={e => setRet(e.target.value)} placeholder="Return" className={`${field} w-full pl-6 tabular-nums`} /></div>
            </div>
          </div>

          {items.length > 0 && (grandTotal > 0) && (
            <div className="rounded-lg bg-zinc-50 ring-1 ring-zinc-100 px-3 py-2 text-[11px] text-zinc-600 tabular-nums space-y-0.5">
              <div className="flex justify-between"><span>Grading fees</span><span>{fmtUSD(feeTotal)}</span></div>
              <div className="flex justify-between"><span>Shipping (out + return)</span><span>{fmtUSD(shipTotal)} → {fmtUSD(perCardShip)}/card</span></div>
              <div className="flex justify-between font-semibold text-zinc-900 pt-0.5 border-t border-zinc-200"><span>Total into cost basis</span><span>{fmtUSD(grandTotal)}</span></div>
            </div>
          )}

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-zinc-100 bg-zinc-50/50 rounded-b-2xl">
          <button type="button" onClick={onClose} disabled={submitting} className="px-4 py-2 rounded-lg text-sm font-semibold text-zinc-700 hover:bg-zinc-100 cursor-pointer disabled:opacity-50">Cancel</button>
          <button type="button" onClick={submit} disabled={submitting || !canSubmit} className="px-5 py-2 rounded-lg text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">{submitting ? 'Saving…' : `Grade ${items.length || ''} card${items.length === 1 ? '' : 's'}`.trim()}</button>
        </div>
      </div>
    </div>
  )
}
