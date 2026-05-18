'use client'

import { useState } from 'react'

interface Props {
  cardId: string
  productId: number
  productName: string
  productUrlName: string | null
  /** Fires after a successful POST. Lets the parent tile dim or otherwise
   *  signal that this card is resolved without triggering a page refresh. */
  onDone?: () => void
}

/** "Assign this TCGplayer product to this card" button. POSTs to
 *  /api/mappings (which writes source='manual', sets cards.art_style, and
 *  records the logged-in admin). Deliberately does NOT refresh the page —
 *  the row stays put so the admin can keep scanning. The clicked button
 *  flips to a checkmark to confirm success; on next page load the card
 *  shows up in the right bucket (mapped section, or hidden entirely if
 *  the assignment flipped its art_style to standard at a low rarity). */
export function AssignMappingButton({ cardId, productId, productName, productUrlName, onDone }: Props) {
  const [state, setState] = useState<'idle' | 'pending' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)

  const tcgUrl = productUrlName
    ? `https://www.tcgplayer.com/product/${productId}/${productUrlName}`
    : `https://www.tcgplayer.com/product/${productId}`

  async function handleClick() {
    setError(null)
    setState('pending')
    try {
      const res = await fetch('/api/mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cardId,
          tcgProductId: productId,
          tcgUrl,
          tcgName: productName,
          price: null,
          // submittedBy left blank — the API resolves the logged-in
          // admin from the auth cookie and writes it to mapped_by.
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      setState('done')
      onDone?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed')
      setState('idle')
    }
  }

  return (
    <div className="flex items-start gap-2 text-xs">
      <a
        href={tcgUrl}
        target="_blank"
        rel="noreferrer"
        className="flex-1 min-w-0 text-blue-600 hover:underline break-words"
      >
        {productName} ↗
      </a>
      <button
        type="button"
        onClick={handleClick}
        disabled={state === 'pending'}
        className={`flex-shrink-0 px-2 py-0.5 rounded font-semibold cursor-pointer w-[68px] text-center ${
          state === 'done'
            ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
            : 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50'
        }`}
      >
        {state === 'pending' ? '...' : state === 'done' ? '✓ Done' : 'Assign'}
      </button>
      {error && <div className="text-[10px] text-red-600 w-full">{error}</div>}
    </div>
  )
}
