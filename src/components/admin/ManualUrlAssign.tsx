'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  cardId: string
  onDone?: () => void
  /** Set true on pages that show the current mapping (e.g. card detail
   *  debug section) so the new tcg_name pulls down without a manual
   *  reload. Off by default — admin grid pages stay still to avoid
   *  layout shift while bulk-assigning. */
  refreshOnDone?: boolean
}

/** Fallback input for when none of the auto-suggested candidates are
 *  right — covers cards whose TCGplayer product lives under a different
 *  card_number than Bandai's (cross-set listings, renumberings) or
 *  products that weren't pulled into tcgplayer_products at all.
 *  Accepts a TCG product URL, extracts the product_id, and assigns. The
 *  API resolves the product name from tcgplayer_products if it exists. */
export function ManualUrlAssign({ cardId, onDone, refreshOnDone = false }: Props) {
  const router = useRouter()
  const [url, setUrl] = useState('')
  const [state, setState] = useState<'idle' | 'pending' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    setError(null)
    // TCG URLs look like https://www.tcgplayer.com/product/586598/...
    const match = url.match(/\/product\/(\d+)/)
    if (!match) {
      setError('Could not find product ID in URL')
      return
    }
    const productId = parseInt(match[1], 10)
    setState('pending')
    try {
      const res = await fetch('/api/mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cardId,
          tcgProductId: productId,
          tcgUrl: url,
          // tcgName omitted intentionally — API looks it up by product_id.
          price: null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      setState('done')
      onDone?.()
      if (refreshOnDone) router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed')
      setState('idle')
    }
  }

  return (
    <div className="mt-1 pt-1 border-t border-zinc-100">
      <div className="text-[10px] text-zinc-400 mb-0.5">Or paste TCG URL if none match:</div>
      <div className="flex items-start gap-1">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.tcgplayer.com/product/..."
          disabled={state === 'pending'}
          className="flex-1 min-w-0 px-2 py-1 text-[11px] border border-zinc-300 rounded focus:outline-none focus:border-blue-500 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={state === 'pending' || url.length === 0}
          className={`flex-shrink-0 px-2 py-0.5 rounded font-semibold cursor-pointer w-[68px] text-center text-xs ${
            state === 'done'
              ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
              : 'bg-zinc-700 text-white hover:bg-zinc-800 disabled:opacity-50'
          }`}
        >
          {state === 'pending' ? '...' : state === 'done' ? '✓ Done' : 'Assign'}
        </button>
      </div>
      {error && <div className="text-[10px] text-red-600 mt-0.5">{error}</div>}
    </div>
  )
}
