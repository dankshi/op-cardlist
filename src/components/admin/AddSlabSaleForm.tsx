'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const COMPANIES = ['PSA', 'BGS', 'CGC', 'TAG']

/** Hand-add a graded sale (source='admin'). On success the affected card's
 *  comp recomputes server-side and the page refreshes. */
export function AddSlabSaleForm() {
  const router = useRouter()
  const today = new Date().toISOString().slice(0, 10)
  const empty = { card_id: '', grading_company: 'PSA', grade: '10', price: '', sold_at: today, title: '', listing_url: '' }
  const [form, setForm] = useState(empty)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const res = await fetch('/api/admin/slab-sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        card_id: form.card_id,
        grading_company: form.grading_company,
        grade: form.grade,
        price: Number(form.price),
        sold_at: form.sold_at,
        title: form.title || undefined,
        listing_url: form.listing_url || undefined,
      }),
    })
    setBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error || 'Failed to add sale.')
      return
    }
    setForm({ ...empty, sold_at: form.sold_at })
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <F label="Card ID">
        <input required value={form.card_id} onChange={e => set('card_id', e.target.value)} placeholder="OP07-051"
          className="border border-zinc-300 rounded px-2 py-1 text-sm w-32" />
      </F>
      <F label="Company">
        <select value={form.grading_company} onChange={e => set('grading_company', e.target.value)}
          className="border border-zinc-300 rounded px-2 py-1 text-sm">
          {COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </F>
      <F label="Grade">
        <input required value={form.grade} onChange={e => set('grade', e.target.value)} placeholder="10"
          className="border border-zinc-300 rounded px-2 py-1 text-sm w-20" />
      </F>
      <F label="Price ($)">
        <input required type="number" min="0" step="0.01" value={form.price} onChange={e => set('price', e.target.value)}
          className="border border-zinc-300 rounded px-2 py-1 text-sm w-28" />
      </F>
      <F label="Sold date">
        <input required type="date" value={form.sold_at} onChange={e => set('sold_at', e.target.value)}
          className="border border-zinc-300 rounded px-2 py-1 text-sm" />
      </F>
      <F label="Note / title (optional)">
        <input value={form.title} onChange={e => set('title', e.target.value)} placeholder="Goldin auction"
          className="border border-zinc-300 rounded px-2 py-1 text-sm w-48" />
      </F>
      <F label="URL (optional)">
        <input value={form.listing_url} onChange={e => set('listing_url', e.target.value)} placeholder="https://…"
          className="border border-zinc-300 rounded px-2 py-1 text-sm w-48" />
      </F>
      <button type="submit" disabled={busy}
        className="px-3 py-1.5 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 cursor-pointer">
        {busy ? 'Adding…' : 'Add sale'}
      </button>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </form>
  )
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</span>
      {children}
    </label>
  )
}
