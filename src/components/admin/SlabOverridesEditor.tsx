'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const COMPANIES = ['PSA', 'BGS', 'CGC', 'TAG']

export interface OverrideRow {
  cardId: string
  cardName: string
  company: string
  grade: string
  value: number
  note: string | null
  setAt: string
}

/** Manage slab_value_overrides — pinned values that win over the computed comp.
 *  Add via the form; remove per-row. Both hit /api/admin/slab-overrides and
 *  refresh. No recompute needed (overrides apply at read time). */
export function SlabOverridesEditor({ rows }: { rows: OverrideRow[] }) {
  const router = useRouter()
  const empty = { card_id: '', grading_company: 'PSA', grade: '10', value: '', note: '' }
  const [form, setForm] = useState(empty)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const res = await fetch('/api/admin/slab-overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        card_id: form.card_id,
        grading_company: form.grading_company,
        grade: form.grade,
        value: Number(form.value),
        note: form.note || undefined,
      }),
    })
    setBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error || 'Failed to save override.')
      return
    }
    setForm(empty)
    router.refresh()
  }

  async function remove(row: OverrideRow) {
    if (!confirm(`Remove the pinned value for ${row.cardId} ${row.company} ${row.grade}?`)) return
    const res = await fetch('/api/admin/slab-overrides', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card_id: row.cardId, grading_company: row.company, grade: row.grade }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      alert(body.error || 'Failed to remove override.')
      return
    }
    router.refresh()
  }

  return (
    <div>
      <form onSubmit={add} className="flex flex-wrap items-end gap-3 mb-4">
        <L label="Card ID">
          <input required value={form.card_id} onChange={e => set('card_id', e.target.value)} placeholder="OP07-051"
            className="border border-zinc-300 rounded px-2 py-1 text-sm w-32" />
        </L>
        <L label="Company">
          <select value={form.grading_company} onChange={e => set('grading_company', e.target.value)}
            className="border border-zinc-300 rounded px-2 py-1 text-sm">
            {COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </L>
        <L label="Grade">
          <input required value={form.grade} onChange={e => set('grade', e.target.value)} placeholder="10"
            className="border border-zinc-300 rounded px-2 py-1 text-sm w-20" />
        </L>
        <L label="Value ($)">
          <input required type="number" min="0" step="0.01" value={form.value} onChange={e => set('value', e.target.value)}
            className="border border-zinc-300 rounded px-2 py-1 text-sm w-28" />
        </L>
        <L label="Note (optional)">
          <input value={form.note} onChange={e => set('note', e.target.value)} placeholder="thin market"
            className="border border-zinc-300 rounded px-2 py-1 text-sm w-48" />
        </L>
        <button type="submit" disabled={busy}
          className="px-3 py-1.5 bg-zinc-900 text-white rounded text-sm font-medium hover:bg-zinc-700 disabled:opacity-50 cursor-pointer">
          {busy ? 'Saving…' : 'Pin value'}
        </button>
        {error && <p className="w-full text-sm text-red-600">{error}</p>}
      </form>

      {rows.length === 0 ? (
        <p className="text-sm text-zinc-400">No pinned values.</p>
      ) : (
        <div className="overflow-x-auto border border-zinc-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2">Card</th>
                <th className="px-3 py-2">Variant</th>
                <th className="px-3 py-2 text-right">Pinned value</th>
                <th className="px-3 py-2">Note</th>
                <th className="px-3 py-2">Set</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={`${row.cardId}|${row.company}|${row.grade}`} className="border-t border-zinc-100">
                  <td className="px-3 py-2">
                    <Link href={`/card/${row.cardId.toLowerCase()}`} className="text-blue-600 hover:underline font-mono text-xs">{row.cardId}</Link>
                    {row.cardName && <div className="text-zinc-500 text-xs">{row.cardName}</div>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.company} {row.grade}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">${row.value.toLocaleString()}</td>
                  <td className="px-3 py-2 text-zinc-600">{row.note ?? '—'}</td>
                  <td className="px-3 py-2 text-zinc-500 whitespace-nowrap">{row.setAt.slice(0, 10)}</td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" onClick={() => remove(row)}
                      className="text-xs px-2 py-1 rounded border border-red-300 text-red-600 hover:bg-red-50 cursor-pointer">
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</span>
      {children}
    </label>
  )
}
