'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CollectionActivityRow } from '@/types/database'
import type { HoldingRow } from './HoldingsGrid'
import { ManageHoldingModal } from './ManageHoldingModal'

function fmtUSD(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/** All logged grade events (grading submissions), newest first — each links to
 *  its slab so you can correct the grade / cert / subgrades / cost. */
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
    fetch('/api/collection/activity?limit=500')
      .then(r => r.json())
      .then(d => { if (!cancelled) setEvents(((d.activity ?? []) as CollectionActivityRow[]).filter(a => a.kind === 'grade')) })
      .finally(() => { if (!cancelled) setLoading(false) })
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

  const totalCost = events.reduce((s, e) => s + (e.amount != null ? Number(e.amount) : 0), 0)

  if (!open) return null

  // Editing routes through the same holding editor (grade/cert/subgrades/cost).
  if (editingRow) {
    return <ManageHoldingModal row={editingRow} onClose={() => setEditingId(null)} onChanged={() => { onChanged(); setEditingId(null) }} />
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-4 py-8" onClick={onClose} role="dialog" aria-modal="true">
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-zinc-100">
          <div>
            <h2 className="text-lg font-bold text-zinc-900">Grading log</h2>
            <p className="text-[11px] text-zinc-500 mt-0.5">Every card you&rsquo;ve graded. Click one to correct its grade, cert, subgrades, or cost.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex-shrink-0 w-8 h-8 inline-flex items-center justify-center rounded-full text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 cursor-pointer">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="px-6 py-4">
          {loading ? (
            <div className="py-10 text-center"><div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" /></div>
          ) : events.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-8">No grading submissions logged yet.</p>
          ) : (
            <>
              <div className="flex justify-between text-[11px] text-zinc-500 mb-2 tabular-nums">
                <span>{events.length} graded</span>
                <span>Total grading cost <span className="font-semibold text-zinc-900">{fmtUSD(totalCost)}</span></span>
              </div>
              <ul className="divide-y divide-zinc-100 max-h-[55vh] overflow-y-auto">
                {events.map(e => {
                  const editable = e.collection_id != null && rowById.has(e.collection_id)
                  return (
                    <li key={`${e.source_id}`} className="py-2.5 flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-zinc-900 truncate">{nameByCard.get(e.card_id) ?? e.card_id}</p>
                        <p className="text-[11px] text-zinc-500">{e.from_grade} → {e.to_grade} · {fmtDate(e.happened_at)}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm tabular-nums text-zinc-900">{e.amount != null ? fmtUSD(Number(e.amount)) : '—'}</p>
                        {e.shipping_cost != null && Number(e.shipping_cost) > 0 && <p className="text-[10px] text-zinc-400 tabular-nums">incl. {fmtUSD(Number(e.shipping_cost))} ship</p>}
                      </div>
                      {editable ? (
                        <button type="button" onClick={() => setEditingId(e.collection_id)} className="flex-shrink-0 px-2.5 py-1 rounded-md text-xs font-semibold text-indigo-600 ring-1 ring-indigo-200 hover:bg-indigo-50 cursor-pointer">Edit</button>
                      ) : (
                        <span className="flex-shrink-0 text-[10px] text-zinc-400 italic w-12 text-center">sold</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
