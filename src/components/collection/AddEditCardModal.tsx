'use client'

import { useEffect, useState } from 'react'
import { CollectionCardSearch, type CardPick } from './CollectionCardSearch'
import { GRADING_SCALES, type GradingCompany } from '@/types/database'

const COMPANIES: GradingCompany[] = ['PSA', 'BGS', 'CGC', 'TAG']

export interface EditItem {
  id: string
  card_id: string
  card_name: string
  card_image: string
  quantity: number
  acquired_price: number | null
  acquired_date: string | null
  gradingCompany: string | null
  grade: string | null
  customValue: number | null
  serialNumber: string | null
}

/** A draft acquisition row in the editor. `id` present = an existing lot we
 *  loaded (so we can diff on save); absent = a new lot to create. */
interface LotDraft {
  id?: string
  quantity: number
  price: string
  date: string
}

function gradeText(company: string | null, grade: string | null): string {
  return company && grade ? `${company} ${grade}` : 'Raw'
}

/** Add a card to the collection, or edit an existing line. Cost basis is kept
 *  per-acquisition: a line can hold several "lots", each with its own quantity,
 *  price paid, and date. Grade is chosen on add (a line's variant is fixed once
 *  created); custom value + serial are variant-level. */
export function AddEditCardModal({
  open,
  onClose,
  onSaved,
  editItem,
  presetCard,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
  editItem?: EditItem | null
  /** Pins "add" mode to a specific card (e.g. adding another copy from that
   *  card's page). Hides the card search. Ignored in edit mode. */
  presetCard?: { id: string; name: string; image: string } | null
}) {
  const isEdit = !!editItem
  const [card, setCard] = useState<CardPick | null>(null)
  const [company, setCompany] = useState('')
  const [grade, setGrade] = useState('')
  const [lots, setLots] = useState<LotDraft[]>([])
  const [loadedLots, setLoadedLots] = useState<LotDraft[]>([])
  const [loadingLots, setLoadingLots] = useState(false)
  // The persisted collection line id. Set from the start in edit mode; in add
  // mode it's null until the first greedy save creates the line. Once set, the
  // card + grade are locked (the line's variant is fixed).
  const [lineId, setLineId] = useState<string | null>(editItem?.id ?? null)
  const committed = lineId != null
  const [customValue, setCustomValue] = useState('')
  const [serial, setSerial] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [pops, setPops] = useState<{ grade: string; count: number }[] | null>(null)

  const cardId = isEdit ? editItem!.card_id : card?.id ?? null

  // Pull PSA population for the chosen card (extra context while logging it).
  useEffect(() => {
    if (!open || !cardId) {
      setPops(null)
      return
    }
    let cancelled = false
    fetch(`/api/cards/${cardId}/populations`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setPops((d.populations?.PSA as { grade: string; count: number }[]) ?? null) })
      .catch(() => { if (!cancelled) setPops(null) })
    return () => { cancelled = true }
  }, [open, cardId])

  // Reset / prefill whenever the modal opens. Syncing form fields to the
  // open/editItem props is exactly what this effect is for.
  useEffect(() => {
    if (!open) return
    setError(null)
    setFlash(null)
    setSubmitting(false)
    if (editItem) {
      setCard({ id: editItem.card_id, name: editItem.card_name, rarity: '', imageUrl: editItem.card_image })
      setCompany(editItem.gradingCompany ?? '')
      setGrade(editItem.grade ?? '')
      setCustomValue(editItem.customValue != null ? String(editItem.customValue) : '')
      setSerial(editItem.serialNumber ?? '')
      setLots([])
      setLoadedLots([])
      setLineId(editItem.id)
    } else {
      setCard(presetCard ? { id: presetCard.id, name: presetCard.name, rarity: '', imageUrl: presetCard.image } : null)
      setCompany('')
      setGrade('')
      setCustomValue('')
      setSerial('')
      setLots([{ quantity: 1, price: '', date: new Date().toISOString().slice(0, 10) }])
      setLoadedLots([])
      setLineId(null)
    }
    // Depend on the preset's fields + the edited line id, not object identity,
    // so a fresh literal from the parent each render doesn't re-fire this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editItem?.id, presetCard?.id, presetCard?.name, presetCard?.image])

  // Load the existing lots when editing, so they can be revised/removed.
  useEffect(() => {
    if (!open || !editItem) return
    let cancelled = false
    setLoadingLots(true)
    fetch(`/api/collection/lots?collection_id=${editItem.id}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        const drafts: LotDraft[] = (d.lots ?? []).map((l: { id: string; quantity: number; price_paid: number | null; acquired_date: string | null }) => ({
          id: l.id,
          quantity: l.quantity,
          price: l.price_paid != null ? String(l.price_paid) : '',
          date: l.acquired_date ?? '',
        }))
        const safe = drafts.length ? drafts : [{ quantity: editItem.quantity || 1, price: '', date: '' }]
        setLots(safe)
        setLoadedLots(safe)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingLots(false) })
    return () => { cancelled = true }
  }, [open, editItem])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !submitting) onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, onClose, submitting])

  if (!open) return null

  function updateLot(i: number, patch: Partial<LotDraft>) {
    setLots(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l))
    setError(null)
  }
  async function addLot() {
    if (submitting) return
    setError(null)
    setFlash(null)
    // Greedy: persist whatever's entered so far before adding a blank row, so
    // closing the modal mid-entry never loses an acquisition.
    if (canSubmit) {
      setSubmitting(true)
      const id = await persistAll()
      setSubmitting(false)
      if (id == null) return // error shown; the user's rows are kept intact
      onSaved()
      setFlash('Saved ✓')
    }
    setLots(prev => [...prev, { quantity: 1, price: '', date: new Date().toISOString().slice(0, 10) }])
  }
  function removeLot(i: number) {
    setLots(prev => prev.filter((_, idx) => idx !== i))
  }

  const cvNum = customValue === '' ? null : Number(customValue)
  const cvValid = cvNum == null || (Number.isFinite(cvNum) && cvNum >= 0)
  const lotsValid = lots.length > 0 && lots.every(l => {
    if (l.quantity < 1) return false
    if (l.price === '') return true
    const n = Number(l.price)
    return Number.isFinite(n) && n >= 0
  })
  const canSubmit = (isEdit || !!card?.id) && lotsValid && cvValid

  async function persistEditLots(collectionId: string): Promise<boolean> {
    // Diff current drafts against what we loaded: create new, update changed,
    // delete removed.
    const seen = new Set<string>()
    for (const lot of lots) {
      if (lot.id) {
        seen.add(lot.id)
        const orig = loadedLots.find(l => l.id === lot.id)
        if (orig && orig.quantity === lot.quantity && orig.price === lot.price && orig.date === lot.date) continue
        const res = await fetch('/api/collection/lots', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: lot.id, quantity: lot.quantity, price_paid: lot.price, acquired_date: lot.date || null }),
        })
        if (!res.ok) return false
      } else {
        const res = await fetch('/api/collection/lots', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ collection_id: collectionId, quantity: lot.quantity, price_paid: lot.price, acquired_date: lot.date || null }),
        })
        if (!res.ok) return false
      }
    }
    for (const orig of loadedLots) {
      if (orig.id && !seen.has(orig.id)) {
        const res = await fetch(`/api/collection/lots?id=${orig.id}`, { method: 'DELETE' })
        if (!res.ok) return false
      }
    }
    return true
  }

  // Persist the whole editor: create the line (add mode, first time) or update
  // variant fields + diff lots (line already exists), then resync drafts with
  // the server so saved lots carry real ids. Returns the line id, or null on
  // failure (error already surfaced). Used by both Save and the greedy
  // "add another acquisition".
  async function persistAll(): Promise<string | null> {
    let id = lineId
    if (id == null) {
      // Add mode, first save — create the line + first lot via the increment
      // RPC, then append any further lots.
      const [first, ...rest] = lots
      const createRes = await fetch('/api/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          card_id: card!.id,
          quantity: first.quantity,
          acquired_price: first.price,
          acquired_date: first.date || null,
          grading_company: company || null,
          grade: company ? grade : null,
          custom_value: customValue || null,
          serial_number: serial || null,
        }),
      })
      if (!createRes.ok) {
        const b = await createRes.json().catch(() => ({}))
        setError(b.error || 'Something went wrong.')
        return null
      }
      const { item } = await createRes.json()
      id = item.id as string
      setLineId(id)
      for (const lot of rest) {
        const r = await fetch('/api/collection/lots', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ collection_id: id, quantity: lot.quantity, price_paid: lot.price, acquired_date: lot.date || null }),
        })
        if (!r.ok) { setError('Failed to save an acquisition.'); return null }
      }
    } else {
      const res = await fetch('/api/collection', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, custom_value: customValue || null, serial_number: serial || null }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        setError(b.error || 'Something went wrong.')
        return null
      }
      const ok = await persistEditLots(id)
      if (!ok) { setError('Failed to save acquisitions.'); return null }
    }

    // Resync drafts with the server so saved lots carry real ids — further
    // edits diff correctly and nothing is re-created.
    try {
      const d = await (await fetch(`/api/collection/lots?collection_id=${id}`)).json()
      const drafts: LotDraft[] = (d.lots ?? []).map((l: { id: string; quantity: number; price_paid: number | null; acquired_date: string | null }) => ({
        id: l.id, quantity: l.quantity, price: l.price_paid != null ? String(l.price_paid) : '', date: l.acquired_date ?? '',
      }))
      if (drafts.length) { setLots(drafts); setLoadedLots(drafts) }
    } catch { /* keep local drafts */ }

    return id
  }

  async function handleSubmit(keepOpen = false) {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    setError(null)
    setFlash(null)
    try {
      const name = card?.name ?? 'card'
      const id = await persistAll()
      if (id == null) return
      onSaved()

      if (keepOpen && !isEdit) {
        // Reset for the next card (add-another-CARD). New card → new line.
        setCard(presetCard ? { id: presetCard.id, name: presetCard.name, rarity: '', imageUrl: presetCard.image } : null)
        setCompany('')
        setGrade('')
        setCustomValue('')
        setSerial('')
        setLots([{ quantity: 1, price: '', date: new Date().toISOString().slice(0, 10) }])
        setLoadedLots([])
        setLineId(null)
        setFlash(`Added ${name} ✓`)
        return
      }
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRemove() {
    if (!isEdit || removing) return
    if (!confirm('Remove this card from your collection?')) return
    setRemoving(true)
    const res = await fetch(`/api/collection?id=${editItem!.id}`, { method: 'DELETE' })
    setRemoving(false)
    if (!res.ok) { setError('Failed to remove.'); return }
    onSaved()
    onClose()
  }

  const fieldClass = 'w-full px-3 py-2.5 rounded-lg border-2 border-zinc-200 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-orange-500 disabled:opacity-50'

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-4 py-8"
      onClick={() => { if (!submitting) onClose() }}
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-7 pt-6 pb-4 border-b border-zinc-100">
          <h2 className="text-xl font-bold text-zinc-900">{isEdit ? 'Edit card' : 'Add card to collection'}</h2>
          <button
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            className="flex-shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-full text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors cursor-pointer disabled:opacity-50"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-7 py-6 space-y-5">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">Card</label>
            {isEdit || presetCard || committed ? (
              <div className="flex items-center gap-3 rounded-lg ring-1 ring-zinc-200 p-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={card?.imageUrl || ''} alt="" className="w-10 h-14 rounded object-cover bg-zinc-100" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-900 truncate">{card?.name}</p>
                  <p className="text-[11px] text-zinc-400 font-mono">{card?.id}</p>
                </div>
              </div>
            ) : (
              <CollectionCardSearch value={card} onSelect={setCard} />
            )}
          </div>

          {/* Grade — Raw or a slab. Chosen on add; fixed once the line exists. */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">Grade</label>
            {isEdit || committed ? (
              <div className="inline-flex items-center rounded-lg bg-zinc-100 px-3 py-2 text-sm font-semibold text-zinc-700">
                {gradeText(company || null, grade || null)}
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {(['', ...COMPANIES] as string[]).map(c => {
                    const active = company === c
                    return (
                      <button
                        key={c || 'raw'}
                        type="button"
                        onClick={() => { setCompany(c); setGrade(c ? GRADING_SCALES[c as GradingCompany][0] : '') }}
                        disabled={submitting}
                        className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
                          active ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:ring-zinc-400'
                        }`}
                      >
                        {c || 'Raw'}
                      </button>
                    )
                  })}
                </div>
                {company && (
                  <select value={grade} onChange={e => setGrade(e.target.value)} disabled={submitting} className={`mt-2 ${fieldClass}`}>
                    {GRADING_SCALES[company as GradingCompany].map(g => (
                      <option key={g} value={g}>{company} {g}</option>
                    ))}
                  </select>
                )}
              </>
            )}
          </div>

          {/* PSA population — extra context on scarcity. */}
          {pops && pops.some(p => p.count > 0) && (
            <div className="rounded-lg bg-zinc-50 ring-1 ring-zinc-100 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">PSA Population</p>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-zinc-600 tabular-nums">
                {pops.map(p => (
                  <span key={p.grade}>PSA {p.grade}: <span className="font-semibold text-zinc-900">{p.count.toLocaleString()}</span></span>
                ))}
              </div>
            </div>
          )}

          {/* Acquisitions — one row per lot (quantity + price paid + date). */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500">Acquisitions</label>
              <span className="text-[11px] text-zinc-400">Price &amp; date are per acquisition</span>
            </div>

            {loadingLots ? (
              <div className="py-6 text-center">
                <div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
              </div>
            ) : (
              <div className="space-y-2">
                {lots.map((lot, i) => (
                  <div key={lot.id ?? `new-${i}`} className="flex items-center gap-2 rounded-lg ring-1 ring-zinc-200 p-2">
                    <div className="inline-flex items-center rounded-md ring-1 ring-zinc-200 overflow-hidden flex-shrink-0">
                      <button type="button" onClick={() => updateLot(i, { quantity: Math.max(1, lot.quantity - 1) })} disabled={lot.quantity <= 1 || submitting} className="px-2 py-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 cursor-pointer">−</button>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={lot.quantity}
                        disabled={submitting}
                        aria-label="Quantity"
                        onFocus={e => e.currentTarget.select()}
                        onChange={e => {
                          const n = parseInt(e.target.value.replace(/\D/g, ''), 10)
                          updateLot(i, { quantity: Number.isFinite(n) && n >= 1 ? n : 1 })
                        }}
                        className="w-9 py-1 text-xs font-bold tabular-nums text-zinc-700 text-center border-x border-zinc-200 focus:outline-none focus:bg-orange-50 disabled:opacity-50"
                      />
                      <button type="button" onClick={() => updateLot(i, { quantity: lot.quantity + 1 })} disabled={submitting} className="px-2 py-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 cursor-pointer">+</button>
                    </div>
                    <div className="relative flex-1 min-w-0">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm font-bold text-zinc-400">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={lot.price}
                        disabled={submitting}
                        placeholder="Price ea"
                        aria-label="Price paid per card"
                        onChange={e => updateLot(i, { price: e.target.value })}
                        className="w-full pl-6 pr-2 py-1.5 rounded-md border border-zinc-200 text-sm tabular-nums text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-orange-500 disabled:opacity-50"
                      />
                    </div>
                    <input
                      type="date"
                      value={lot.date}
                      disabled={submitting}
                      aria-label="Acquired date"
                      onChange={e => updateLot(i, { date: e.target.value })}
                      className="flex-shrink-0 w-[8.5rem] px-2 py-1.5 rounded-md border border-zinc-200 text-xs text-zinc-900 focus:outline-none focus:border-orange-500 disabled:opacity-50"
                    />
                    <button
                      type="button"
                      onClick={() => removeLot(i)}
                      disabled={submitting || lots.length <= 1}
                      aria-label="Remove acquisition"
                      title={lots.length <= 1 ? 'Use Remove to delete the card' : 'Remove acquisition'}
                      className="flex-shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-md text-zinc-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-400 cursor-pointer disabled:cursor-default"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addLot}
                  disabled={submitting}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-orange-600 hover:text-orange-700 cursor-pointer disabled:opacity-50"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Add another acquisition
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">Value override <span className="text-zinc-400 font-normal normal-case">/ card</span></label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-base font-bold text-zinc-400">$</span>
                <input type="number" step="0.01" min="0" value={customValue} onChange={e => { setCustomValue(e.target.value); setError(null) }} disabled={submitting} placeholder="Use market" className={`${fieldClass} pl-7 font-semibold tabular-nums`} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">
                Serial <span className="text-zinc-400 font-normal normal-case">(numbered)</span>
              </label>
              <input type="text" value={serial} onChange={e => setSerial(e.target.value)} disabled={submitting} placeholder="e.g. 012/100" className={fieldClass} />
            </div>
          </div>
          <p className="text-[11px] text-zinc-400 -mt-2 leading-snug">
            Value override sets this card&rsquo;s current value in your portfolio — handy when market data is thin (e.g. BGS Black Label). Leave blank to use market price.
          </p>

          {error && <div className="rounded-lg bg-red-50 ring-1 ring-red-200 p-3 text-sm text-red-700">{error}</div>}
        </div>

        <div className="flex items-center gap-2 px-7 py-4 border-t border-zinc-100 bg-zinc-50/50 rounded-b-2xl">
          {isEdit ? (
            <button onClick={handleRemove} disabled={submitting || removing} className="px-3 py-2 rounded-lg text-sm font-semibold text-red-600 hover:bg-red-50 cursor-pointer disabled:opacity-50">
              {removing ? 'Removing…' : 'Remove'}
            </button>
          ) : flash ? (
            <span className="text-sm font-semibold text-emerald-600">{flash}</span>
          ) : null}
          <div className="flex-1" />
          <button onClick={onClose} disabled={submitting} className="px-4 py-2 rounded-lg text-sm font-semibold text-zinc-700 hover:bg-zinc-100 cursor-pointer disabled:opacity-50">
            {isEdit ? 'Cancel' : 'Done'}
          </button>
          {!isEdit && (
            <button onClick={() => handleSubmit(true)} disabled={submitting || !canSubmit} className="px-4 py-2.5 rounded-lg text-sm font-bold text-orange-600 ring-1 ring-orange-300 hover:bg-orange-50 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
              Save &amp; add another
            </button>
          )}
          <button onClick={() => handleSubmit(false)} disabled={submitting || !canSubmit} className="px-5 py-2.5 rounded-lg text-sm font-bold bg-orange-500 hover:bg-orange-600 text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Add to collection'}
          </button>
        </div>
      </div>
    </div>
  )
}
