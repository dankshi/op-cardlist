'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { Order } from '@/types/database'

interface Props {
  orders: Order[]
  onOrdersChange: (next: Order[]) => void
  hasShippingAddress: boolean
}

const STATUS_TONE: Record<string, string> = {
  paid: 'bg-amber-100 text-amber-800',
  seller_shipped: 'bg-blue-100 text-blue-800',
  received: 'bg-blue-100 text-blue-800',
  exception_review: 'bg-red-100 text-red-800',
  authenticated: 'bg-purple-100 text-purple-800',
  shipped_to_buyer: 'bg-indigo-100 text-indigo-800',
  delivered: 'bg-emerald-100 text-emerald-800',
  under_review: 'bg-red-100 text-red-800',
}

function statusLabel(s: string) {
  return s.replace(/_/g, ' ')
}

// Resolve the per-component fees for display. New orders store the split;
// legacy orders only have the rolled-up platform_fee, so fall back to that.
function fees(o: Order) {
  let marketplace = Number(o.marketplace_fee || 0)
  const seller = Number(o.seller_fee || 0)
  const processing = Number(o.processing_fee || 0)
  if (marketplace === 0 && seller === 0 && processing === 0 && Number(o.platform_fee) > 0) {
    marketplace = Number(o.platform_fee)
  }
  const payout = Math.max(0, Number(o.subtotal) - marketplace - seller - processing)
  return { marketplace, seller, processing, payout }
}

export function OrdersTable({ orders, onOrdersChange, hasShippingAddress }: Props) {
  const [onlyAction, setOnlyAction] = useState(false)
  const [labelFor, setLabelFor] = useState<Order | null>(null)

  const needsAction = (o: Order) => o.status === 'paid' && !o.seller_label_url
  const actionCount = orders.filter(needsAction).length

  const rows = useMemo(
    () => (onlyAction ? orders.filter(needsAction) : orders),
    [orders, onlyAction],
  )

  function patchOrder(updated: Order) {
    onOrdersChange(orders.map(o => o.id === updated.id ? updated : o))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-zinc-200 overflow-hidden">
          <button
            onClick={() => setOnlyAction(false)}
            className={`px-3 py-2 text-sm font-medium transition-colors ${!onlyAction ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-600 hover:bg-zinc-50'}`}
          >
            All sales <span className="ml-1 text-xs opacity-70">{orders.length}</span>
          </button>
          <button
            onClick={() => setOnlyAction(true)}
            className={`px-3 py-2 text-sm font-medium transition-colors ${onlyAction ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-600 hover:bg-zinc-50'}`}
          >
            Needs label <span className="ml-1 text-xs opacity-70">{actionCount}</span>
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-xl p-12 text-center text-sm text-zinc-500">
          {onlyAction ? 'Nothing needs a label right now.' : 'No sales yet.'}
        </div>
      ) : (
        <div className="overflow-x-auto bg-white border border-zinc-200 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500">
                <th className="px-3 py-2.5">Order</th>
                <th className="px-3 py-2.5">Item(s)</th>
                <th className="px-3 py-2.5 text-right">Sale</th>
                <th className="px-3 py-2.5 text-right">Mkt fee</th>
                <th className="px-3 py-2.5 text-right">Proc fee</th>
                <th className="px-3 py-2.5 text-right">Ship fee</th>
                <th className="px-3 py-2.5 text-right">Payout</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(o => {
                const f = fees(o)
                const itemNames = (o.items || []).map(i => i.card_name).filter(Boolean)
                return (
                  <tr key={o.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50/60 align-top">
                    <td className="px-3 py-2">
                      <Link href={`/orders/${o.id}`} className="font-mono text-xs text-orange-600 hover:underline">
                        {o.id.slice(0, 8)}
                      </Link>
                      <p className="text-[11px] text-zinc-400">{new Date(o.created_at).toLocaleDateString()}</p>
                    </td>
                    <td className="px-3 py-2 text-zinc-700">
                      <p className="truncate max-w-[220px]">{itemNames.join(', ') || '—'}</p>
                      {o.buyer?.display_name && <p className="text-[11px] text-zinc-400">to {o.buyer.display_name}</p>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-900">${Number(o.subtotal).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-500">${f.marketplace.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-500">${f.processing.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-500">${f.seller.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-700">${f.payout.toFixed(2)}</td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${STATUS_TONE[o.status] || 'bg-zinc-100 text-zinc-700'}`}>
                        {statusLabel(o.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col items-end gap-1">
                        <a
                          href={`/api/orders/${o.id}/packing-slip`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2 py-1 rounded text-[11px] font-semibold uppercase tracking-wider text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-100 transition-colors"
                        >
                          Packing slip
                        </a>
                        {o.seller_label_url ? (
                          <a
                            href={o.seller_label_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2 py-1 rounded text-[11px] font-semibold uppercase tracking-wider text-blue-700 ring-1 ring-blue-500/40 hover:bg-blue-600 hover:text-white transition-colors"
                          >
                            Download label
                          </a>
                        ) : o.status === 'paid' ? (
                          hasShippingAddress ? (
                            <button
                              onClick={() => setLabelFor(o)}
                              className="px-2 py-1 rounded text-[11px] font-semibold uppercase tracking-wider text-orange-600 ring-1 ring-orange-500/40 hover:bg-orange-500 hover:text-white transition-colors cursor-pointer"
                            >
                              Create label
                            </button>
                          ) : (
                            <Link
                              href="/profile/edit"
                              className="px-2 py-1 rounded text-[11px] font-semibold uppercase tracking-wider text-amber-700 ring-1 ring-amber-400/50 hover:bg-amber-50 transition-colors"
                              title="Add your shipping address first"
                            >
                              Add address
                            </Link>
                          )
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {labelFor && (
        <LabelModal
          order={labelFor}
          onClose={() => setLabelFor(null)}
          onShipped={patchOrder}
        />
      )}
    </div>
  )
}

interface Rate {
  rate_id: string
  carrier: string
  service: string
  estimated_cost: number
  estimated_days: number | null
}

/** Compact label flow — reuses the same estimate + label endpoints the
 *  order detail page uses, so the seller can ship without leaving the hub. */
function LabelModal({
  order, onClose, onShipped,
}: {
  order: Order
  onClose: () => void
  onShipped: (o: Order) => void
}) {
  const [rates, setRates] = useState<Rate[] | null>(null)
  const [selected, setSelected] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadRates() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/orders/${order.id}/label/estimate`)
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Could not fetch rates'); return }
      setRates(data.rates || [])
      if (data.rates?.[0]) setSelected(data.rates[0].rate_id)
    } catch {
      setError('Could not fetch rates')
    } finally {
      setLoading(false)
    }
  }

  async function createLabel() {
    if (!selected) return
    setCreating(true)
    setError(null)
    try {
      const res = await fetch(`/api/orders/${order.id}/label`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rateId: selected }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Label generation failed'); return }
      onShipped({
        ...order,
        seller_label_url: data.label_url,
        seller_tracking_number: data.tracking_number,
        seller_tracking_carrier: data.carrier,
        seller_label_cost: data.cost,
        status: 'seller_shipped',
      })
      if (data.label_url) window.open(data.label_url, '_blank')
      onClose()
    } catch {
      setError('Label generation failed')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-4 py-10" onClick={onClose}>
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-zinc-100">
          <div>
            <h2 className="text-lg font-bold text-zinc-900">Ship to Nomi</h2>
            <p className="text-xs text-zinc-500 mt-0.5 font-mono">{order.id.slice(0, 8)}</p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-900 cursor-pointer">✕</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {!rates && (
            <button
              onClick={loadRates}
              disabled={loading}
              className="w-full px-4 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition-colors cursor-pointer disabled:opacity-50"
            >
              {loading ? 'Fetching rates…' : 'Get shipping options'}
            </button>
          )}

          {rates && rates.length === 0 && (
            <p className="text-sm text-zinc-500">No shipping rates available right now.</p>
          )}

          {rates && rates.length > 0 && (
            <div className="space-y-2">
              {rates.map(r => (
                <label
                  key={r.rate_id}
                  className={`flex items-center justify-between gap-3 p-3 rounded-lg border cursor-pointer ${selected === r.rate_id ? 'border-orange-500 bg-orange-50' : 'border-zinc-200 hover:bg-zinc-50'}`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="rate"
                      checked={selected === r.rate_id}
                      onChange={() => setSelected(r.rate_id)}
                      className="accent-orange-500"
                    />
                    <div>
                      <p className="text-sm font-medium text-zinc-900">{r.carrier} {r.service}</p>
                      {r.estimated_days != null && <p className="text-xs text-zinc-500">~{r.estimated_days} days</p>}
                    </div>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-zinc-900">${Number(r.estimated_cost).toFixed(2)}</span>
                </label>
              ))}
              <button
                onClick={createLabel}
                disabled={creating || !selected}
                className="w-full mt-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors cursor-pointer disabled:opacity-50"
              >
                {creating ? 'Creating label…' : 'Create label & mark shipped'}
              </button>
            </div>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
      </div>
    </div>
  )
}
