'use client'

import { useState } from 'react'
import { gradeLabel } from '@/lib/gradingStyle'
import { AddEditCardModal, type EditItem } from './AddEditCardModal'

export interface PositionRow {
  id: string
  condition: string | null
  gradingCompany: string | null
  grade: string | null
  quantity: number
  acquiredPrice: number | null
  acquiredDate: string | null
  customValue: number | null
  serialNumber: string | null
  currentValue: number | null
  costBasis: number | null
  gain: number | null
  gainPct: number | null
}

function fmtUSD(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** "Your position" block on the card page — Robinhood-style. Shows the lines
 *  the user owns of THIS card (value, cost basis, gain/loss) with inline Edit
 *  (opens the collection editor) and List-for-sale (drives the page's list
 *  flow for that grade). */
export function CollectionPositionPanel({
  cardId,
  cardName,
  imageUrl,
  rows,
  onList,
  onChanged,
}: {
  cardId: string
  cardName: string
  imageUrl: string
  rows: PositionRow[]
  onList: (row: PositionRow) => void
  /** Called after an add / edit / remove so the parent can re-pull and
   *  re-value the rows client-side (no page refresh). */
  onChanged: () => void
}) {
  const [editRow, setEditRow] = useState<PositionRow | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  // Row id currently mid-update from a quantity step, so we can disable its
  // buttons and avoid double-fires while the PATCH + reload round-trips.
  const [pendingId, setPendingId] = useState<string | null>(null)

  // Set a line's total quantity. Routed through the lots endpoint, which
  // grows/shrinks the loose (unpriced) lot so a quick tweak never needs a
  // price. Floors at 1 (use Edit → Remove to delete a line); on success the
  // parent re-pulls + re-values. No-ops when unchanged or already mid-request.
  async function setQty(row: PositionRow, next: number) {
    if (!Number.isFinite(next)) return
    const qty = Math.floor(next)
    if (qty < 1 || qty === row.quantity || pendingId) return
    setPendingId(row.id)
    try {
      const res = await fetch('/api/collection/lots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection_id: row.id, action: 'set_total', total_quantity: qty }),
      })
      if (res.ok) onChanged()
    } finally {
      setPendingId(null)
    }
  }

  if (rows.length === 0) return null

  const totalValue = rows.reduce((s, r) => s + (r.currentValue ?? 0), 0)
  const totalCost = rows.reduce((s, r) => s + (r.costBasis ?? 0), 0)
  const totalGain = totalCost > 0 ? totalValue - totalCost : null
  const totalGainPct = totalGain != null && totalCost > 0 ? totalGain / totalCost : null
  const totalUp = (totalGain ?? 0) >= 0

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
      {/* Header — title only. Own card chrome so the panel reads as a distinct
          "your holdings" surface, not part of the buy box. */}
      <div className="flex items-center gap-2 px-4 py-3 bg-zinc-50/70 border-b border-zinc-100">
        <svg className="w-4 h-4 text-zinc-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18" />
        </svg>
        <h3 className="text-sm font-bold text-zinc-900 truncate">In your collection</h3>
      </div>

      {/* Per-line holdings */}
      <div className="divide-y divide-zinc-100">
        {rows.map(row => {
          const up = (row.gain ?? 0) >= 0
          const busy = pendingId === row.id
          return (
            <div key={row.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-semibold text-zinc-900">
                      {gradeLabel(row.gradingCompany, row.grade)}
                    </span>
                    {row.serialNumber && (
                      <span className="text-[11px] text-zinc-400 tabular-nums">#{row.serialNumber}</span>
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-400 tabular-nums mt-0.5">
                    {row.acquiredPrice != null ? `Paid ${fmtUSD(row.acquiredPrice)}${row.quantity > 1 ? ' ea' : ''}` : 'No cost basis'}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold tabular-nums text-zinc-900">
                    {row.currentValue != null ? fmtUSD(row.currentValue) : '—'}
                  </p>
                  {row.gain != null && (
                    <p className={`text-[11px] font-semibold tabular-nums mt-0.5 ${up ? 'text-emerald-600' : 'text-red-600'}`}>
                      {up ? '+' : '−'}{fmtUSD(Math.abs(row.gain))}{row.gainPct != null ? ` (${up ? '+' : '−'}${(Math.abs(row.gainPct) * 100).toFixed(1)}%)` : ''}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 mt-2.5">
                {/* Quick quantity stepper for this line. */}
                <div className="inline-flex items-center rounded-md ring-1 ring-zinc-200 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setQty(row, row.quantity - 1)}
                    disabled={row.quantity <= 1 || busy}
                    aria-label="Decrease quantity"
                    className="px-2 py-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 disabled:cursor-default cursor-pointer"
                  >
                    −
                  </button>
                  <input
                    // Remount on quantity change so the uncontrolled value
                    // resets to the server truth after a reload.
                    key={row.quantity}
                    type="text"
                    inputMode="numeric"
                    defaultValue={row.quantity}
                    disabled={busy}
                    aria-label="Quantity"
                    onFocus={e => e.currentTarget.select()}
                    onKeyDown={e => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                      else if (e.key === 'Escape') { e.currentTarget.value = String(row.quantity); e.currentTarget.blur() }
                    }}
                    onBlur={e => {
                      const n = parseInt(e.currentTarget.value.replace(/\D/g, ''), 10)
                      if (!Number.isFinite(n) || n < 1) { e.currentTarget.value = String(row.quantity); return }
                      setQty(row, n)
                    }}
                    className="w-10 py-1 text-xs font-bold tabular-nums text-zinc-700 text-center border-x border-zinc-200 focus:outline-none focus:bg-orange-50 disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => setQty(row, row.quantity + 1)}
                    disabled={busy}
                    aria-label="Increase quantity"
                    className="px-2 py-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 cursor-pointer"
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setEditRow(row)}
                  className="rounded-md px-2.5 py-1 text-xs font-semibold text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-50 transition-colors cursor-pointer"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => onList(row)}
                  className="rounded-md px-2.5 py-1 text-xs font-semibold text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200 hover:bg-emerald-100 transition-colors cursor-pointer"
                >
                  List for sale
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Add another — its own full-width row button. */}
      <button
        type="button"
        onClick={() => setAddOpen(true)}
        className="flex items-center justify-center gap-1.5 w-full px-4 py-3 text-sm font-semibold text-orange-600 border-t border-zinc-100 hover:bg-orange-50/60 transition-colors cursor-pointer"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        Add another
      </button>

      {/* Total value — footer row, always shown. */}
      <div className="flex items-baseline justify-between gap-3 px-4 py-3 border-t border-zinc-100 bg-zinc-50/70">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Total value</span>
        <div className="flex items-baseline gap-2">
          <span className="text-base font-bold tabular-nums text-zinc-900">{fmtUSD(totalValue)}</span>
          {totalGain != null && (
            <span className={`text-xs font-semibold tabular-nums ${totalUp ? 'text-emerald-600' : 'text-red-600'}`}>
              {totalUp ? '+' : '−'}{fmtUSD(Math.abs(totalGain))}
              {totalGainPct != null ? ` (${totalUp ? '+' : '−'}${(Math.abs(totalGainPct) * 100).toFixed(1)}%)` : ''}
            </span>
          )}
        </div>
      </div>

      <AddEditCardModal
        open={!!editRow || addOpen}
        onClose={() => { setEditRow(null); setAddOpen(false) }}
        onSaved={onChanged}
        editItem={editRow ? {
          id: editRow.id,
          card_id: cardId,
          card_name: cardName,
          card_image: imageUrl,
          quantity: editRow.quantity,
          acquired_price: editRow.acquiredPrice,
          acquired_date: editRow.acquiredDate,
          gradingCompany: editRow.gradingCompany,
          grade: editRow.grade,
          customValue: editRow.customValue,
          serialNumber: editRow.serialNumber,
        } satisfies EditItem : null}
        presetCard={editRow ? null : { id: cardId, name: cardName, image: imageUrl }}
      />
    </div>
  )
}
