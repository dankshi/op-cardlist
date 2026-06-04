'use client'

import { useRef, useState } from 'react'
import { GRADING_SCALES, type GradingCompany, type Listing } from '@/types/database'
import { CardSearchCell, type CardPick } from './CardSearchCell'

interface Props {
  onCreated: (listings: Listing[]) => void
}

interface DraftRow {
  key: number
  card: CardPick | null
  isGraded: boolean
  gradingCompany: GradingCompany
  grade: string
  price: string
  qty: string
  language: string
}

interface SubmitPayloadRow {
  card_id: string
  title: string
  price: number
  quantity: number
  language: string
  grading_company: string | null
  grade: string | null
}

interface ServerResult {
  created: Listing[]
  errors: { row: number; message: string }[]
}

const GRADERS: GradingCompany[] = ['PSA', 'CGC', 'BGS', 'TAG']

function blankRow(key: number): DraftRow {
  return { key, card: null, isGraded: false, gradingCompany: 'PSA', grade: '10', price: '', qty: '1', language: 'EN' }
}

export function BulkCreate({ onCreated }: Props) {
  const [mode, setMode] = useState<'table' | 'csv'>('table')
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-zinc-200 overflow-hidden">
        {(['table', 'csv'] as const).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              mode === m ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-600 hover:bg-zinc-50'
            }`}
          >
            {m === 'table' ? 'Row builder' : 'CSV / paste'}
          </button>
        ))}
      </div>
      {mode === 'table' ? <TableMode onCreated={onCreated} /> : <CsvMode onCreated={onCreated} />}
    </div>
  )
}

// ── Shared submit ────────────────────────────────────────────────────────
async function postBulk(rows: SubmitPayloadRow[]): Promise<ServerResult | { error: string }> {
  const res = await fetch('/api/listings/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok && !data.created) return { error: data.error || 'Bulk create failed' }
  return data as ServerResult
}

function ResultBanner({ result }: { result: ServerResult | null }) {
  if (!result) return null
  return (
    <div className={`rounded-lg p-3 text-sm ${result.errors.length ? 'bg-amber-50 border border-amber-200 text-amber-800' : 'bg-emerald-50 border border-emerald-200 text-emerald-800'}`}>
      Created {result.created.length} listing{result.created.length === 1 ? '' : 's'}.
      {result.errors.length > 0 && (
        <ul className="mt-1 list-disc list-inside text-amber-700">
          {result.errors.map((e, i) => <li key={i}>Row {e.row + 1}: {e.message}</li>)}
        </ul>
      )}
    </div>
  )
}

// ── Table mode ───────────────────────────────────────────────────────────
function TableMode({ onCreated }: Props) {
  const counter = useRef(3)
  const [rows, setRows] = useState<DraftRow[]>([blankRow(0), blankRow(1), blankRow(2)])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ServerResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  function update(key: number, patch: Partial<DraftRow>) {
    setRows(rows.map(r => r.key === key ? { ...r, ...patch } : r))
  }
  function addRow() {
    setRows([...rows, blankRow(counter.current++)])
  }
  function removeRow(key: number) {
    setRows(rows.filter(r => r.key !== key))
  }

  const ready = rows.filter(r => r.card && r.card.id && parseFloat(r.price) > 0)

  async function submit() {
    if (ready.length === 0) { setError('Add at least one row with a card and a price.'); return }
    setError(null)
    setBusy(true)
    const payload: SubmitPayloadRow[] = ready.map(r => ({
      card_id: r.card!.id,
      title: r.card!.name,
      price: parseFloat(r.price),
      quantity: parseInt(r.qty) || 1,
      language: r.language,
      grading_company: r.isGraded ? r.gradingCompany : null,
      grade: r.isGraded ? r.grade : null,
    }))
    const res = await postBulk(payload)
    setBusy(false)
    if ('error' in res) { setError(res.error); return }
    setResult(res)
    if (res.created.length > 0) {
      onCreated(res.created)
      // Reset to a fresh trio of blank rows.
      counter.current += 3
      setRows([blankRow(counter.current - 3), blankRow(counter.current - 2), blankRow(counter.current - 1)])
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-500">
        Pick a card per row, set the price and quantity, then create them all at once.
      </p>

      <div className="overflow-x-auto bg-white border border-zinc-200 rounded-xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500">
              <th className="px-3 py-2.5">Card</th>
              <th className="px-3 py-2.5">Type</th>
              <th className="px-3 py-2.5">Price</th>
              <th className="px-3 py-2.5">Qty</th>
              <th className="px-3 py-2.5">Lang</th>
              <th className="px-3 py-2.5 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} className="border-b border-zinc-100 last:border-0 align-top">
                <td className="px-3 py-2">
                  <CardSearchCell value={r.card} onSelect={card => update(r.key, { card: card.id ? card : null })} />
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-col gap-1">
                    <select
                      value={r.isGraded ? 'graded' : 'raw'}
                      onChange={e => update(r.key, { isGraded: e.target.value === 'graded' })}
                      className="px-2 py-1.5 rounded border border-zinc-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                    >
                      <option value="raw">Raw (NM)</option>
                      <option value="graded">Graded</option>
                    </select>
                    {r.isGraded && (
                      <div className="flex gap-1">
                        <select
                          value={r.gradingCompany}
                          onChange={e => update(r.key, { gradingCompany: e.target.value as GradingCompany, grade: GRADING_SCALES[e.target.value as GradingCompany][0] })}
                          className="px-1.5 py-1 rounded border border-zinc-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                        >
                          {GRADERS.map(g => <option key={g} value={g}>{g}</option>)}
                        </select>
                        <select
                          value={r.grade}
                          onChange={e => update(r.key, { grade: e.target.value })}
                          className="px-1.5 py-1 rounded border border-zinc-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                        >
                          {GRADING_SCALES[r.gradingCompany].map(g => <option key={g} value={g}>{g}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <span className="text-zinc-400">$</span>
                    <input
                      type="number" step="0.01" min="0.01"
                      value={r.price}
                      onChange={e => update(r.key, { price: e.target.value })}
                      placeholder="0.00"
                      className="w-20 px-1.5 py-1 rounded border border-zinc-200 tabular-nums focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number" min="1" step="1"
                    value={r.qty}
                    onChange={e => update(r.key, { qty: e.target.value })}
                    className="w-14 px-1.5 py-1 rounded border border-zinc-200 tabular-nums focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </td>
                <td className="px-3 py-2">
                  <select
                    value={r.language}
                    onChange={e => update(r.key, { language: e.target.value })}
                    className="px-1.5 py-1 rounded border border-zinc-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  >
                    <option value="EN">EN</option>
                    <option value="JP">JP</option>
                  </select>
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => removeRow(r.key)}
                    className="text-zinc-400 hover:text-red-500 cursor-pointer"
                    title="Remove row"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      <ResultBanner result={result} />

      <div className="flex items-center gap-2">
        <button onClick={addRow} className="px-3 py-2 rounded-lg border border-zinc-200 text-sm font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer">
          + Add row
        </button>
        <button
          onClick={submit}
          disabled={busy || ready.length === 0}
          className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition-colors cursor-pointer disabled:opacity-50"
        >
          {busy ? 'Creating…' : `Create ${ready.length || ''} listing${ready.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  )
}

// ── CSV mode ─────────────────────────────────────────────────────────────
interface CsvRow {
  card_id: string
  price: string
  qty: string
  grading_company: string
  grade: string
  language: string
  error: string | null
}

function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const out: CsvRow[] = []
  for (const line of lines) {
    // Skip a header row if present.
    if (/^card_id\s*,/i.test(line)) continue
    const [card_id = '', price = '', qty = '1', grading_company = '', grade = '', language = 'EN'] =
      line.split(',').map(c => c.trim())
    let error: string | null = null
    if (!card_id) error = 'Missing card_id'
    else if (!(parseFloat(price) > 0)) error = 'Price must be > 0'
    else if ((grading_company === '') !== (grade === '')) error = 'Set both grading company and grade, or neither'
    out.push({ card_id, price, qty: qty || '1', grading_company, grade, language: language || 'EN', error })
  }
  return out
}

function CsvMode({ onCreated }: Props) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ServerResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const parsed = text.trim() ? parseCsv(text) : []
  const valid = parsed.filter(r => !r.error)

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setText(String(reader.result || ''))
    reader.readAsText(file)
  }

  async function submit() {
    if (valid.length === 0) { setError('No valid rows to import.'); return }
    setError(null)
    setBusy(true)
    const payload: SubmitPayloadRow[] = valid.map(r => ({
      card_id: r.card_id,
      title: r.card_id, // server falls back to card_id when no name resolved
      price: parseFloat(r.price),
      quantity: parseInt(r.qty) || 1,
      language: r.language,
      grading_company: r.grading_company || null,
      grade: r.grade || null,
    }))
    const res = await postBulk(payload)
    setBusy(false)
    if ('error' in res) { setError(res.error); return }
    setResult(res)
    if (res.created.length > 0) {
      onCreated(res.created)
      setText('')
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-500">
        One listing per line: <code className="text-xs bg-zinc-100 px-1 py-0.5 rounded">card_id,price,qty,grading_company,grade,language</code>.
        Leave grading_company &amp; grade empty for raw NM. A header row is optional.
      </p>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={8}
        placeholder={'OP01-001,12.00,3\nOP05-119_p,45.00,1\nOP01-016,300.00,1,PSA,10'}
        className="w-full px-3 py-2 font-mono text-sm bg-white border border-zinc-200 rounded-lg text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
      />
      <div className="flex items-center gap-3">
        <label className="px-3 py-2 rounded-lg border border-zinc-200 text-sm font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer">
          Upload .csv
          <input type="file" accept=".csv,text/csv,text/plain" onChange={onFile} className="hidden" />
        </label>
        <span className="text-xs text-zinc-500">
          {parsed.length} row{parsed.length === 1 ? '' : 's'} parsed · {valid.length} valid
        </span>
      </div>

      {parsed.length > 0 && (
        <div className="overflow-x-auto bg-white border border-zinc-200 rounded-xl max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500">
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">card_id</th>
                <th className="px-3 py-2">price</th>
                <th className="px-3 py-2">qty</th>
                <th className="px-3 py-2">variant</th>
                <th className="px-3 py-2">status</th>
              </tr>
            </thead>
            <tbody>
              {parsed.map((r, i) => (
                <tr key={i} className="border-b border-zinc-100 last:border-0">
                  <td className="px-3 py-1.5 text-zinc-400">{i + 1}</td>
                  <td className="px-3 py-1.5 font-mono text-zinc-900">{r.card_id || <span className="text-red-400">—</span>}</td>
                  <td className="px-3 py-1.5 tabular-nums">{r.price}</td>
                  <td className="px-3 py-1.5 tabular-nums">{r.qty}</td>
                  <td className="px-3 py-1.5 text-zinc-600">{r.grading_company ? `${r.grading_company} ${r.grade}` : 'Raw NM'}</td>
                  <td className="px-3 py-1.5">
                    {r.error
                      ? <span className="text-red-500 text-xs">{r.error}</span>
                      : <span className="text-emerald-600 text-xs">OK</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}
      <ResultBanner result={result} />

      <button
        onClick={submit}
        disabled={busy || valid.length === 0}
        className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition-colors cursor-pointer disabled:opacity-50"
      >
        {busy ? 'Importing…' : `Import ${valid.length || ''} listing${valid.length === 1 ? '' : 's'}`}
      </button>
    </div>
  )
}
