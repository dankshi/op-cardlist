'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { HoverThumb } from '@/components/admin/HoverThumb'

export interface SlabSaleRow {
  id: string
  cardId: string
  cardName: string
  source: string
  company: string
  grade: string
  price: number
  soldAt: string
  title: string
  listingUrl: string | null
  cardImageUrl: string | null
  ebayImageUrl: string | null
  listingFormat: string | null
  language: string | null
  status: 'visible' | 'hidden' | 'excluded'
  excludedReason: string | null
  parseConfidence: string | null
}

/** Review queue table. Each row can be excluded (drop from the comp) or
 *  restored; rows can also be multi-selected for a bulk exclude/restore.
 *  Mutations are optimistic, then router.refresh() re-pulls the server page so
 *  the recomputed values + counts update. */
export function SlabSalesTable({ rows }: { rows: SlabSaleRow[] }) {
  const router = useRouter()
  const [overrides, setOverrides] = useState<Record<string, SlabSaleRow['status']>>({})
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  function statusOf(row: SlabSaleRow) {
    return overrides[row.id] ?? row.status
  }

  async function setStatus(row: SlabSaleRow, status: SlabSaleRow['status']) {
    setBusy(b => ({ ...b, [row.id]: true }))
    const prev = statusOf(row)
    setOverrides(o => ({ ...o, [row.id]: status }))
    const res = await fetch(`/api/admin/slab-sales/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    setBusy(b => ({ ...b, [row.id]: false }))
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setOverrides(o => ({ ...o, [row.id]: prev }))
      alert(body.error || 'Failed to update sale.')
      return
    }
    router.refresh()
  }

  async function bulk(status: SlabSaleRow['status']) {
    const ids = [...selected]
    if (ids.length === 0) return
    setBulkBusy(true)
    const res = await fetch('/api/admin/slab-sales/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, status }),
    })
    setBulkBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      alert(body.error || 'Bulk update failed.')
      return
    }
    setSelected(new Set())
    router.refresh()
  }

  function toggle(id: string) {
    setSelected(s => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleAll() {
    setSelected(s => (s.size === rows.length ? new Set() : new Set(rows.map(r => r.id))))
  }

  if (rows.length === 0) {
    return <p className="text-sm text-zinc-400 py-8 text-center border border-dashed border-zinc-200 rounded-lg">No sales match these filters.</p>
  }

  return (
    <div>
      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-2 px-3 py-2 bg-zinc-100 rounded-lg text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <button type="button" disabled={bulkBusy} onClick={() => bulk('excluded')}
            className="px-2 py-1 rounded border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50 cursor-pointer">
            Exclude selected
          </button>
          <button type="button" disabled={bulkBusy} onClick={() => bulk('visible')}
            className="px-2 py-1 rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 cursor-pointer">
            Restore selected
          </button>
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-zinc-500 hover:text-zinc-900">
            Clear
          </button>
        </div>
      )}

      <div className="overflow-x-auto border border-zinc-200 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2 w-8">
                <input type="checkbox" checked={selected.size === rows.length} onChange={toggleAll} aria-label="Select all" />
              </th>
              <th className="px-3 py-2">Card</th>
              <th className="px-3 py-2">Verify</th>
              <th className="px-3 py-2">Variant</th>
              <th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2">Sold</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const status = statusOf(row)
              const isVisible = status === 'visible'
              const statusClass =
                status === 'visible' ? 'bg-emerald-100 text-emerald-700'
                : status === 'excluded' ? 'bg-amber-100 text-amber-700'
                : 'bg-zinc-100 text-zinc-600'
              return (
                <tr key={row.id} className={`border-t border-zinc-100 ${isVisible ? '' : 'bg-zinc-50/60'}`}>
                  <td className="px-3 py-2 align-top">
                    <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} aria-label={`Select ${row.cardId}`} />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Link href={`/card/${row.cardId.toLowerCase()}`} className="text-blue-600 hover:underline font-mono text-xs">
                      {row.cardId}
                    </Link>
                    {row.cardName && <div className="text-zinc-500 text-xs">{row.cardName}</div>}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {/* Our card vs the eBay listing photo, side by side. Hover
                        either to expand for quick verification. */}
                    <div className="flex items-start gap-1.5">
                      {row.cardImageUrl
                        ? <HoverThumb src={row.cardImageUrl} alt={`${row.cardId} (ours)`} href={`/card/${row.cardId.toLowerCase()}`} className="w-11 rounded border border-zinc-200" />
                        : <ImgPlaceholder label="ours" />}
                      {row.ebayImageUrl
                        ? <HoverThumb src={row.ebayImageUrl} alt="eBay listing photo" className="w-11 rounded border border-zinc-200" />
                        : <ImgPlaceholder label="eBay" />}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top whitespace-nowrap">
                    {row.company} {row.grade}
                    {row.language === 'japanese' && (
                      <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-rose-50 text-rose-600" title="Japanese print">JP</span>
                    )}
                  </td>
                  <td className={`px-3 py-2 align-top text-right tabular-nums ${row.listingFormat === 'best_offer' ? 'text-zinc-400 line-through' : ''}`} title={row.listingFormat === 'best_offer' ? 'Accepted-offer ask — not the real sale price' : undefined}>${row.price.toLocaleString()}</td>
                  <td className="px-3 py-2 align-top whitespace-nowrap text-zinc-600">{row.soldAt.slice(0, 10)}</td>
                  <td className="px-3 py-2 align-top">
                    <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600">{row.source}</span>
                    {row.listingFormat === 'best_offer' && (
                      <span className="ml-1 text-xs px-1.5 py-0.5 rounded bg-orange-50 text-orange-600" title="Best Offer — eBay shows the asking price, not the (hidden) accepted offer">best offer</span>
                    )}
                    {row.parseConfidence === 'low' && row.listingFormat !== 'best_offer' && (
                      <span className="ml-1 text-xs px-1.5 py-0.5 rounded bg-red-50 text-red-600" title="Low parse confidence">parse?</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top max-w-[280px]">
                    {row.listingUrl ? (
                      <a href={row.listingUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline line-clamp-2">{row.title} ↗</a>
                    ) : (
                      <span className="text-zinc-600 line-clamp-2">{row.title}</span>
                    )}
                    {status === 'excluded' && row.excludedReason && (
                      <div className="text-[11px] text-amber-600 mt-0.5">excluded: {row.excludedReason}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span className={`text-xs px-2 py-0.5 rounded ${statusClass}`}>{status}</span>
                  </td>
                  <td className="px-3 py-2 align-top text-right">
                    {isVisible ? (
                      <button type="button" disabled={busy[row.id]} onClick={() => setStatus(row, 'excluded')}
                        className="text-xs px-2 py-1 rounded border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50 cursor-pointer">
                        Exclude
                      </button>
                    ) : (
                      <button type="button" disabled={busy[row.id]} onClick={() => setStatus(row, 'visible')}
                        className="text-xs px-2 py-1 rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 cursor-pointer">
                        Restore
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ImgPlaceholder({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center justify-center w-11 h-14 rounded border border-dashed border-zinc-200 text-[9px] text-zinc-300">
      {label}
    </span>
  )
}
