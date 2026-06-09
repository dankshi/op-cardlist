'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import { gradeLabel } from '@/lib/gradingStyle'
import type { CollectionItem, Listing } from '@/types/database'

function fmtUSD(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Your collection, surfaced in Seller Hub so you can list any owned card for
 *  sale in one step. Price is unset by default (suggested = market); listing
 *  creates an active listing without removing the card from your collection. */
export function CollectionListPanel({
  items,
  cardImages,
  cardNames,
  marketPrices,
  existingListings,
  onListed,
}: {
  items: CollectionItem[]
  cardImages: Record<string, string>
  cardNames: Record<string, string>
  marketPrices: Record<string, number>
  existingListings: Listing[]
  onListed: (listing: Listing) => void
}) {
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  // Card+grade combos already actively listed — so we don't prompt to list
  // something that's already on the market.
  const activeKeys = useMemo(() => {
    const s = new Set<string>()
    for (const l of existingListings) {
      if (l.status === 'active') s.add(`${l.card_id}|${l.grading_company ?? ''}|${l.grade ?? ''}`)
    }
    return s
  }, [existingListings])

  const rows = items.filter(c => !activeKeys.has(`${c.card_id}|${c.grading_company ?? ''}|${c.grade ?? ''}`))

  async function list(item: CollectionItem) {
    const key = item.id
    const market = marketPrices[item.card_id]
    const priceStr = prices[key] ?? (market != null ? String(market) : '')
    const price = Number(priceStr)
    if (!Number.isFinite(price) || price <= 0) return
    setBusy(key)
    const name = cardNames[item.card_id] || item.card_id
    const title = `${name}${item.grading_company && item.grade ? ` (${item.grading_company} ${item.grade})` : ' (NM)'}`
    const res = await fetch('/api/listings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        card_id: item.card_id,
        title,
        price,
        condition: item.condition ?? 'near_mint',
        quantity: item.quantity,
        language: 'EN',
        is_first_edition: false,
        photo_urls: [],
        grading_company: item.grading_company,
        grade: item.grade,
      }),
    })
    setBusy(null)
    if (res.ok) {
      const created = await res.json().catch(() => null)
      if (created) onListed(created as Listing)
    } else {
      const b = await res.json().catch(() => ({}))
      alert(b.error || 'Failed to list. Complete seller setup first.')
    }
  }

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-base font-bold text-zinc-900">Quick-list from your collection</h3>
        <span className="text-xs text-zinc-400 tabular-nums">{rows.length} not listed</span>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-zinc-400 rounded-lg border border-zinc-200 bg-white p-4">
          Everything in your collection is already listed, or your collection is empty.
        </p>
      ) : (
        <div className="rounded-lg border border-zinc-200 bg-white divide-y divide-zinc-100">
          {rows.map(item => {
            const market = marketPrices[item.card_id]
            return (
              <div key={item.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="relative w-8 h-11 shrink-0 rounded bg-zinc-100 overflow-hidden">
                  {cardImages[item.card_id] && (
                    <Image src={cardImages[item.card_id]} alt="" fill sizes="32px" className="object-cover" unoptimized />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-zinc-900 truncate">{cardNames[item.card_id] || item.card_id}</p>
                  <p className="text-[11px] text-zinc-400">
                    {gradeLabel(item.grading_company, item.grade)}{item.quantity > 1 ? ` · ×${item.quantity}` : ''}
                    {market != null ? ` · market ${fmtUSD(market)}` : ''}
                  </p>
                </div>
                <div className="relative w-28 shrink-0">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-zinc-400">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={prices[item.id] ?? ''}
                    onChange={e => setPrices(p => ({ ...p, [item.id]: e.target.value }))}
                    placeholder={market != null ? market.toFixed(2) : 'price'}
                    className="w-full pl-6 pr-2 py-1.5 rounded-md border border-zinc-200 text-sm tabular-nums text-zinc-900 focus:outline-none focus:border-orange-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => list(item)}
                  disabled={busy === item.id}
                  className="shrink-0 px-3 py-1.5 rounded-md text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white transition-colors cursor-pointer disabled:opacity-50"
                >
                  {busy === item.id ? '…' : 'List'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
