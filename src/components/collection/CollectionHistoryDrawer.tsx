'use client'

import { useEffect, useState } from 'react'
import { GRADING_SCALES, type GradingCompany, type CollectionActivityRow } from '@/types/database'
import { gradeLabel } from '@/lib/gradingStyle'

const COMPANIES: GradingCompany[] = ['PSA', 'BGS', 'CGC', 'TAG']

export interface HistoryLine {
  id: string
  gradingCompany: string | null
  grade: string | null
  quantity: number
}

function fmtUSD(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtDate(s: string) {
  // UTC-pinned: stored dates are UTC-anchored (a date column casts to UTC
  // midnight), so formatting in local time would shift them a day back.
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/** Per-card activity feed (docs/collection-pnl.md, Phase 2): the buy/sell/grade
 *  history for one card, plus inline "Record sale" (off-platform) and "Record
 *  grading" actions. Mutations refresh the feed and call onChanged so the
 *  position panel re-values. */
export function CollectionHistoryDrawer({
  open,
  onClose,
  cardId,
  cardName,
  lines,
  onChanged,
}: {
  open: boolean
  onClose: () => void
  cardId: string
  cardName: string
  lines: HistoryLine[]
  onChanged: () => void
}) {
  const [activity, setActivity] = useState<CollectionActivityRow[]>([])
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'feed' | 'sell' | 'grade'>('feed')

  async function loadActivity() {
    setLoading(true)
    try {
      const res = await fetch(`/api/collection/activity?card_id=${encodeURIComponent(cardId)}`)
      if (res.ok) setActivity((await res.json()).activity ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    setMode('feed')
    loadActivity()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; document.removeEventListener('keydown', onKey) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cardId])

  if (!open) return null

  function afterMutation() {
    onChanged()
    loadActivity()
    setMode('feed')
  }

  const realizedTotal = activity
    .filter(a => a.kind === 'sell' && a.realized != null)
    .reduce((s, a) => s + Number(a.realized), 0)

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-4 py-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-7 pt-6 pb-4 border-b border-zinc-100">
          <div>
            <h2 className="text-xl font-bold text-zinc-900">History</h2>
            <p className="text-sm text-zinc-500 truncate">{cardName}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex-shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-full text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors cursor-pointer">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {mode === 'feed' && (
          <>
            <div className="flex items-center gap-2 px-7 py-3 border-b border-zinc-100">
              <button onClick={() => setMode('sell')} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200 hover:bg-emerald-100 cursor-pointer">Record sale</button>
              {lines.some(l => !l.gradingCompany) && (
                <button onClick={() => setMode('grade')} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50 cursor-pointer">Record grading</button>
              )}
              {Math.abs(realizedTotal) >= 0.005 && (
                <span className="ml-auto text-xs tabular-nums">
                  <span className="text-zinc-400">Realized </span>
                  <span className={`font-semibold ${realizedTotal >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {realizedTotal >= 0 ? '+' : '−'}{fmtUSD(Math.abs(realizedTotal))}
                  </span>
                </span>
              )}
            </div>

            <div className="px-7 py-5 max-h-[60vh] overflow-y-auto">
              {loading ? (
                <div className="py-10 text-center"><div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" /></div>
              ) : activity.length === 0 ? (
                <p className="text-sm text-zinc-500 text-center py-8">No activity yet.</p>
              ) : (
                <ol className="relative border-l border-zinc-200 ml-1.5 space-y-4">
                  {activity.map(a => (
                    <li key={`${a.kind}-${a.source_id}`} className="ml-4">
                      <span className={`absolute -left-[5px] w-2.5 h-2.5 rounded-full ${a.kind === 'sell' ? 'bg-emerald-500' : a.kind === 'grade' ? 'bg-purple-500' : 'bg-zinc-400'}`} />
                      <ActivityRow row={a} />
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </>
        )}

        {mode === 'sell' && (
          <SellForm cardId={cardId} lines={lines} onCancel={() => setMode('feed')} onDone={afterMutation} />
        )}
        {mode === 'grade' && (
          <GradeForm lines={lines.filter(l => !l.gradingCompany)} onCancel={() => setMode('feed')} onDone={afterMutation} />
        )}
      </div>
    </div>
  )
}

function ActivityRow({ row }: { row: CollectionActivityRow }) {
  const qty = row.quantity ?? 1
  if (row.kind === 'buy') {
    return (
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-zinc-900">Bought ×{qty}{row.to_grade && row.to_grade.trim() !== '' ? ` · ${row.to_grade}` : ''}</p>
          <p className="text-[11px] text-zinc-400">{fmtDate(row.happened_at)}</p>
        </div>
        <span className="text-sm tabular-nums text-zinc-500">{row.amount != null ? `${fmtUSD(Number(row.amount))} ea` : 'No cost'}</span>
      </div>
    )
  }
  if (row.kind === 'sell') {
    const realized = row.realized != null ? Number(row.realized) : null
    return (
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-zinc-900">Sold ×{qty}</p>
          <p className="text-[11px] text-zinc-400">{fmtDate(row.happened_at)} · {row.ref_order_id ? 'Nomi' : 'Manual'}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold tabular-nums text-zinc-900">{row.amount != null ? fmtUSD(Number(row.amount)) : '—'}</p>
          {realized != null && (
            <p className={`text-[11px] font-semibold tabular-nums ${realized >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {realized >= 0 ? '+' : '−'}{fmtUSD(Math.abs(realized))} realized
            </p>
          )}
        </div>
      </div>
    )
  }
  // grade / basis / note
  return (
    <div className="flex items-baseline justify-between gap-2">
      <div>
        <p className="text-sm font-semibold text-zinc-900">
          {row.kind === 'grade' ? `Graded ${row.from_grade ?? ''} → ${row.to_grade ?? ''}` : (row.note ?? 'Adjustment')}
        </p>
        <p className="text-[11px] text-zinc-400">{fmtDate(row.happened_at)}</p>
      </div>
      {row.amount != null && Number(row.amount) > 0 && (
        <span className="text-sm tabular-nums text-zinc-500">−{fmtUSD(Number(row.amount))}</span>
      )}
    </div>
  )
}

const fieldClass = 'w-full px-3 py-2.5 rounded-lg border-2 border-zinc-200 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-orange-500 disabled:opacity-50'

function SellForm({ cardId, lines, onCancel, onDone }: { cardId: string; lines: HistoryLine[]; onCancel: () => void; onDone: () => void }) {
  void cardId
  const [collectionId, setCollectionId] = useState(lines[0]?.id ?? '')
  const [quantity, setQuantity] = useState(1)
  const [proceeds, setProceeds] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const line = lines.find(l => l.id === collectionId)
  const maxQty = line?.quantity ?? 1

  async function submit() {
    setSubmitting(true)
    setError(null)
    const res = await fetch('/api/collection/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collection_id: collectionId, quantity, proceeds, sold_at: new Date(date).toISOString() }),
    })
    setSubmitting(false)
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || 'Failed to record sale'); return }
    onDone()
  }

  return (
    <div className="px-7 py-6 space-y-4">
      <h3 className="text-sm font-bold text-zinc-900">Record a sale</h3>
      <div>
        <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">Which copies</label>
        <select value={collectionId} onChange={e => setCollectionId(e.target.value)} className={fieldClass}>
          {lines.map(l => (
            <option key={l.id} value={l.id}>{gradeLabel(l.gradingCompany, l.grade)} · {l.quantity} held</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">Qty</label>
          <input type="number" min={1} max={maxQty} value={quantity} onChange={e => setQuantity(Math.max(1, Math.min(maxQty, parseInt(e.target.value) || 1)))} className={fieldClass} />
        </div>
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">Total $</label>
          <input type="number" step="0.01" min="0" value={proceeds} onChange={e => setProceeds(e.target.value)} placeholder="Proceeds" className={fieldClass} />
        </div>
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className={fieldClass} />
        </div>
      </div>
      {error && <div className="rounded-lg bg-red-50 ring-1 ring-red-200 p-3 text-sm text-red-700">{error}</div>}
      <div className="flex items-center gap-2 pt-1">
        <button onClick={onCancel} disabled={submitting} className="px-4 py-2 rounded-lg text-sm font-semibold text-zinc-700 hover:bg-zinc-100 cursor-pointer">Cancel</button>
        <div className="flex-1" />
        <button onClick={submit} disabled={submitting || !collectionId} className="px-5 py-2.5 rounded-lg text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer disabled:opacity-50">
          {submitting ? 'Saving…' : 'Record sale'}
        </button>
      </div>
    </div>
  )
}

function GradeForm({ lines, onCancel, onDone }: { lines: HistoryLine[]; onCancel: () => void; onDone: () => void }) {
  const [collectionId, setCollectionId] = useState(lines[0]?.id ?? '')
  const [company, setCompany] = useState<GradingCompany>('PSA')
  const [grade, setGrade] = useState(GRADING_SCALES.PSA[0])
  const [cost, setCost] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setSubmitting(true)
    setError(null)
    const res = await fetch('/api/collection/adjustments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'regrade', collection_id: collectionId, grading_company: company, grade, grading_cost: cost }),
    })
    setSubmitting(false)
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || 'Failed to record grading'); return }
    onDone()
  }

  return (
    <div className="px-7 py-6 space-y-4">
      <h3 className="text-sm font-bold text-zinc-900">Record grading</h3>
      <p className="text-xs text-zinc-500 -mt-2">Moves a raw copy to its graded slab; the fee folds into its cost basis.</p>
      <div>
        <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">Which copies</label>
        <select value={collectionId} onChange={e => setCollectionId(e.target.value)} className={fieldClass}>
          {lines.map(l => (
            <option key={l.id} value={l.id}>{gradeLabel(l.gradingCompany, l.grade)} · {l.quantity} held</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">Company</label>
          <select value={company} onChange={e => { const c = e.target.value as GradingCompany; setCompany(c); setGrade(GRADING_SCALES[c][0]) }} className={fieldClass}>
            {COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">Grade</label>
          <select value={grade} onChange={e => setGrade(e.target.value)} className={fieldClass}>
            {GRADING_SCALES[company].map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">Fee $</label>
          <input type="number" step="0.01" min="0" value={cost} onChange={e => setCost(e.target.value)} placeholder="0.00" className={fieldClass} />
        </div>
      </div>
      {error && <div className="rounded-lg bg-red-50 ring-1 ring-red-200 p-3 text-sm text-red-700">{error}</div>}
      <div className="flex items-center gap-2 pt-1">
        <button onClick={onCancel} disabled={submitting} className="px-4 py-2 rounded-lg text-sm font-semibold text-zinc-700 hover:bg-zinc-100 cursor-pointer">Cancel</button>
        <div className="flex-1" />
        <button onClick={submit} disabled={submitting || !collectionId} className="px-5 py-2.5 rounded-lg text-sm font-bold bg-orange-500 hover:bg-orange-600 text-white cursor-pointer disabled:opacity-50">
          {submitting ? 'Saving…' : 'Record grading'}
        </button>
      </div>
    </div>
  )
}
