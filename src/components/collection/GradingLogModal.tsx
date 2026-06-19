'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CollectionActivityRow } from '@/types/database'
import type { HoldingRow } from './HoldingsGrid'
import { ManageHoldingModal } from './ManageHoldingModal'

function fmtUSD(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtSigned(n: number) {
  return `${n >= 0 ? '+' : '−'}${fmtUSD(Math.abs(n))}`
}
function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/** Every grading submission, newest-first. Each submission groups the cards
 *  graded together, shows the grading "premium" each slab carries over the raw
 *  card today (= graded value − raw value − grading cost — the profit from the
 *  grade itself, independent of the card's own appreciation), and links each
 *  slab so you can correct its grade / cert / subgrades / cost. */
export function GradingLogModal({
  open,
  onClose,
  rows,
  onChanged,
}: {
  open: boolean
  onClose: () => void
  rows: HoldingRow[]
  onChanged: () => void
}) {
  const [events, setEvents] = useState<CollectionActivityRow[]>([])
  const [rawByCard, setRawByCard] = useState<Map<string, number | null>>(new Map())
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)

  const nameByCard = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of rows) if (!m.has(r.cardId)) m.set(r.cardId, r.cardName)
    return m
  }, [rows])
  const rowById = useMemo(() => new Map(rows.map(r => [r.id, r])), [rows])
  const editingRow = editingId ? rowById.get(editingId) ?? null : null

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const d = await (await fetch('/api/collection/activity?limit=500')).json()
        const grades = ((d.activity ?? []) as CollectionActivityRow[]).filter(a => a.kind === 'grade')
        if (cancelled) return
        setEvents(grades)
        // Raw market value per card (for the grading premium = graded − raw − cost).
        const cardIds = [...new Set(grades.map(g => g.card_id))]
        if (cardIds.length) {
          const cd = await (await fetch(`/api/cards?ids=${cardIds.map(encodeURIComponent).join(',')}`)).json()
          if (cancelled) return
          const m = new Map<string, number | null>()
          for (const c of (cd.cards ?? []) as { id: string; price?: { marketPrice?: number | null } }[]) m.set(c.id.toUpperCase(), c.price?.marketPrice ?? null)
          setRawByCard(m)
        }
      } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { if (editingId) setEditingId(null); else onClose() } }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, onClose, editingId])

  // Premium = (current graded value) − (current raw value) − (grading cost).
  // Null when the slab is sold/gone or either value is unknown.
  function premiumFor(e: CollectionActivityRow): number | null {
    const slab = e.collection_id ? rowById.get(e.collection_id) : null
    const graded = slab?.marketPrice ?? null
    const raw = rawByCard.get(e.card_id.toUpperCase()) ?? null
    if (graded == null || raw == null) return null
    return graded - raw - (e.amount != null ? Number(e.amount) : 0)
  }

  // Group the grade events by the submission they were graded in.
  const groups = useMemo(() => {
    const m = new Map<string, { id: string; date: string; company: string; label: string | null; events: CollectionActivityRow[] }>()
    for (const e of events) {
      const key = e.submission_id ?? `solo-${e.source_id}`
      let g = m.get(key)
      if (!g) { g = { id: key, date: e.happened_at, company: (e.to_grade ?? '').split(' ')[0] || 'Grade', label: e.submission_label ?? null, events: [] }; m.set(key, g) }
      if (!g.label && e.submission_label) g.label = e.submission_label
      g.events.push(e)
      if (e.happened_at > g.date) g.date = e.happened_at
    }
    return [...m.values()].sort((a, b) => b.date.localeCompare(a.date))
  }, [events])

  const totalCost = events.reduce((s, e) => s + (e.amount != null ? Number(e.amount) : 0), 0)
  const totalPremium = events.reduce((s, e) => { const p = premiumFor(e); return p == null ? s : s + p }, 0)

  if (!open) return null
  if (editingRow) {
    return <ManageHoldingModal row={editingRow} onClose={() => setEditingId(null)} onChanged={() => { onChanged(); setEditingId(null) }} />
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-4 py-8" onClick={onClose} role="dialog" aria-modal="true">
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-zinc-100">
          <div>
            <h2 className="text-lg font-bold text-zinc-900">Grading log</h2>
            <p className="text-[11px] text-zinc-500 mt-0.5">Your submissions. &ldquo;Premium&rdquo; is what the grade adds over the raw card today, net of cost — your grading profit even as the card moves.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex-shrink-0 w-8 h-8 inline-flex items-center justify-center rounded-full text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 cursor-pointer">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="px-6 py-4">
          {loading ? (
            <div className="py-10 text-center"><div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" /></div>
          ) : groups.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-8">No grading submissions logged yet.</p>
          ) : (
            <>
              {/* Scorecard summary */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="rounded-lg bg-zinc-50 ring-1 ring-zinc-100 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-zinc-400 font-semibold">Grading cost</p>
                  <p className="text-sm font-bold tabular-nums text-zinc-900">{fmtUSD(totalCost)}</p>
                </div>
                <div className="rounded-lg bg-zinc-50 ring-1 ring-zinc-100 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-zinc-400 font-semibold">Grading P&amp;L</p>
                  <p className={`text-sm font-bold tabular-nums ${totalPremium >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtSigned(totalPremium)}</p>
                </div>
                <div className="rounded-lg bg-zinc-50 ring-1 ring-zinc-100 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-zinc-400 font-semibold">Submissions</p>
                  <p className="text-sm font-bold tabular-nums text-zinc-900">{groups.length}</p>
                </div>
              </div>

              <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
                {groups.map(g => {
                  const gCost = g.events.reduce((s, e) => s + (e.amount != null ? Number(e.amount) : 0), 0)
                  const gPrem = g.events.reduce((s, e) => { const p = premiumFor(e); return p == null ? s : s + p }, 0)
                  const hasPrem = g.events.some(e => premiumFor(e) != null)
                  return (
                    <div key={g.id} className="rounded-lg ring-1 ring-zinc-200">
                      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-zinc-100 bg-zinc-50/60 rounded-t-lg">
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-zinc-800 truncate">{g.label ? <>{g.company} <span className="font-mono font-semibold text-zinc-600">{g.label}</span></> : `${g.company} submission`} <span className="text-zinc-400 font-normal">· {g.events.length} {g.events.length === 1 ? 'card' : 'cards'}</span></p>
                          <p className="text-[10px] text-zinc-400">{fmtDate(g.date)}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-[10px] text-zinc-400 tabular-nums">cost {fmtUSD(gCost)}</p>
                          {hasPrem && <p className={`text-xs font-bold tabular-nums ${gPrem >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtSigned(gPrem)}</p>}
                        </div>
                      </div>
                      <ul className="divide-y divide-zinc-100">
                        {g.events.map(e => {
                          const editable = e.collection_id != null && rowById.has(e.collection_id)
                          const prem = premiumFor(e)
                          return (
                            <li key={e.source_id} className="flex items-center gap-2 px-3 py-2">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-zinc-900 truncate">{nameByCard.get(e.card_id) ?? e.card_id}</p>
                                <p className="text-[11px] text-zinc-500">{e.to_grade} · cost {e.amount != null ? fmtUSD(Number(e.amount)) : '—'}</p>
                              </div>
                              {prem != null && <span className={`text-xs font-semibold tabular-nums flex-shrink-0 ${prem >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtSigned(prem)}</span>}
                              {editable ? (
                                <button type="button" onClick={() => setEditingId(e.collection_id)} className="flex-shrink-0 px-2 py-1 rounded-md text-[11px] font-semibold text-indigo-600 ring-1 ring-indigo-200 hover:bg-indigo-50 cursor-pointer">Edit</button>
                              ) : (
                                <span className="flex-shrink-0 text-[10px] text-zinc-400 italic w-10 text-center">sold</span>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
