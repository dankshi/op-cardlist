'use client'

import { useCallback, useEffect, useState } from 'react'

interface Onboarding {
  id: number
  set_id: string
  name: string
  bandai_series_id: string
  bandai_site: string
  tcgplayer_slugs: string[]
  release_date: string | null
  status: 'draft' | 'staging' | 'staged' | 'promoted' | 'failed'
  staged_card_count: number
  error: string | null
}

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-zinc-100 text-zinc-600',
  staging: 'bg-blue-100 text-blue-800',
  staged: 'bg-amber-100 text-amber-800',
  promoted: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-800',
}

export function OnboardingSection() {
  const [rows, setRows] = useState<Onboarding[]>([])
  const [busy, setBusy] = useState<number | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [form, setForm] = useState({ set_id: '', name: '', bandai_series_id: '', bandai_site: 'en', tcgplayer_slugs: '', release_date: '' })
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/scraper-hq/onboarding')
    if (res.ok) setRows((await res.json()).onboardings)
  }, [])
  useEffect(() => { load() }, [load]) // eslint-disable-line react-hooks/set-state-in-effect

  async function create() {
    if (!form.set_id || !form.name || !form.bandai_series_id) { setMsg('set id, name, and Bandai series id are required.'); return }
    setCreating(true); setMsg(null)
    const res = await fetch('/api/admin/scraper-hq/onboarding', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
    })
    setCreating(false)
    if (res.ok) { setForm({ set_id: '', name: '', bandai_series_id: '', bandai_site: 'en', tcgplayer_slugs: '', release_date: '' }); load() }
    else { const b = await res.json().catch(() => ({})); setMsg(b.error || 'Failed to create.') }
  }

  async function act(id: number, action: 'stage' | 'promote') {
    setBusy(id); setMsg(null)
    const res = await fetch(`/api/admin/scraper-hq/onboarding/${id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
    })
    const b = await res.json().catch(() => ({}))
    setBusy(null)
    if (res.ok) {
      setMsg(action === 'stage' ? '✓ Staging triggered — refresh in ~1 min to review.' : `✓ Promoted ${b.promoted} cards live. Prices/sales will pick the set up on the next run.`)
      load()
    } else setMsg(b.error || 'Action failed.')
  }

  async function remove(id: number) {
    if (!confirm('Delete this onboarding draft (and its staged cards)?')) return
    setBusy(id)
    await fetch(`/api/admin/scraper-hq/onboarding?id=${id}`, { method: 'DELETE' })
    setBusy(null); load()
  }

  const inputCls = 'px-3 py-2 rounded-lg border border-zinc-300 text-sm text-zinc-900 focus:outline-none focus:border-zinc-500'

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <h2 className="text-xs font-bold uppercase tracking-wide text-zinc-500 mb-1">Onboard a new set</h2>
      <p className="text-sm text-zinc-500 mb-3">Describe the set + scrape links. It stages into a review area first — nothing hits the live catalog until you promote.</p>

      {/* Create form */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-2">
        <input value={form.set_id} onChange={e => setForm(f => ({ ...f, set_id: e.target.value }))} placeholder="Set id (e.g. op-17)" className={inputCls} />
        <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Name (e.g. OP-17 - …)" className={inputCls} />
        <input value={form.bandai_series_id} onChange={e => setForm(f => ({ ...f, bandai_series_id: e.target.value }))} placeholder="Bandai series id (e.g. 569117)" className={inputCls} />
        <select value={form.bandai_site} onChange={e => setForm(f => ({ ...f, bandai_site: e.target.value }))} className={`${inputCls} bg-white cursor-pointer`}>
          <option value="en">en (English site)</option>
          <option value="asia-en">asia-en (early/JP images)</option>
        </select>
        <input value={form.tcgplayer_slugs} onChange={e => setForm(f => ({ ...f, tcgplayer_slugs: e.target.value }))} placeholder="TCGplayer slug(s), comma-sep" className={inputCls} />
        <input type="date" value={form.release_date} onChange={e => setForm(f => ({ ...f, release_date: e.target.value }))} className={inputCls} />
      </div>
      <button onClick={create} disabled={creating} className="px-4 py-2 rounded-lg text-sm font-bold bg-orange-500 hover:bg-orange-600 text-white cursor-pointer disabled:opacity-50">{creating ? 'Adding…' : 'Add draft'}</button>
      {msg && <p className="mt-2 text-sm font-semibold text-zinc-700">{msg}</p>}

      {/* Drafts list */}
      {rows.length > 0 && (
        <div className="mt-4 divide-y divide-zinc-100 border-t border-zinc-100">
          {rows.map(r => (
            <div key={r.id} className="py-3 flex items-center gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-zinc-900">
                  <span className="font-mono text-xs text-zinc-500">{r.set_id}</span> {r.name}
                  <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${STATUS_STYLE[r.status]}`}>{r.status}</span>
                </p>
                <p className="text-[11px] text-zinc-400">
                  series {r.bandai_series_id} · {r.bandai_site} · slugs: {r.tcgplayer_slugs.join(', ') || '—'}
                  {r.status === 'staged' ? ` · ${r.staged_card_count} cards staged` : ''}
                  {r.error ? ` · ⚠ ${r.error}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {(r.status === 'draft' || r.status === 'failed') && (
                  <button onClick={() => act(r.id, 'stage')} disabled={busy === r.id} className="px-3 py-1.5 rounded-md text-sm font-semibold bg-zinc-900 text-white hover:bg-zinc-800 cursor-pointer disabled:opacity-50">{busy === r.id ? '…' : 'Stage'}</button>
                )}
                {r.status === 'staged' && (
                  <button onClick={() => act(r.id, 'promote')} disabled={busy === r.id} className="px-3 py-1.5 rounded-md text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer disabled:opacity-50">{busy === r.id ? '…' : 'Promote live'}</button>
                )}
                {r.status !== 'promoted' && (
                  <button onClick={() => remove(r.id)} disabled={busy === r.id} className="px-2 py-1.5 rounded-md text-sm font-semibold text-red-600 hover:bg-red-50 cursor-pointer disabled:opacity-50">Delete</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
