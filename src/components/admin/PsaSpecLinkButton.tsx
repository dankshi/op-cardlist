'use client'

import { useState } from 'react'

interface Props {
  cardId: string
  specId: number
  description: string
  variety: string | null
  totalPop: number | null
  linkedToCardId: string | null
}

/** Click-to-link a PSA spec to a card. Inverse framing of PsaAssignThumb
 *  — used on the card-centric worklist where each row is a card and each
 *  button represents a candidate PSA spec to attach. Hits the same
 *  PATCH /api/admin/pops-psa/[specId] endpoint. */
export function PsaSpecLinkButton({ cardId, specId, description, variety, totalPop, linkedToCardId }: Props) {
  const [state, setState] = useState<'idle' | 'pending' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setError(null)
    setState('pending')
    try {
      const res = await fetch(`/api/admin/pops-psa/${specId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      setState('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
      setState('idle')
    }
  }

  const isOtherCard = linkedToCardId && linkedToCardId !== cardId
  const isAlreadyMe = linkedToCardId === cardId
  const isDone = state === 'done' || isAlreadyMe

  return (
    <div className={`text-xs border rounded p-2 ${isDone ? 'border-emerald-300 bg-emerald-50' : isOtherCard ? 'border-amber-200 bg-amber-50' : 'border-zinc-200'}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-medium flex items-center gap-1 flex-wrap">
            <span>{description}</span>
            {variety && (
              <span className="text-[10px] bg-zinc-200 text-zinc-700 px-1 rounded">{variety}</span>
            )}
          </div>
          <div className="text-[11px] text-zinc-500 mt-0.5 flex items-center gap-1 flex-wrap">
            <a href={`https://www.psacard.com/spec/psa/${specId}`} target="_blank" rel="noreferrer" className="hover:underline">
              spec {specId} ↗
            </a>
            {totalPop != null && <span>· pop {totalPop.toLocaleString()}</span>}
            {isOtherCard && (
              <span className="text-amber-700">· currently linked to <code className="bg-amber-100 px-1 rounded">{linkedToCardId}</code></span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={handleClick}
          disabled={state === 'pending' || isDone}
          className={`flex-shrink-0 px-2 py-0.5 rounded text-xs font-semibold cursor-pointer ${
            isDone
              ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
              : isOtherCard
                ? 'bg-amber-600 text-white hover:bg-amber-700'
                : 'bg-blue-600 text-white hover:bg-blue-700'
          } disabled:opacity-50`}
        >
          {state === 'pending' ? '...' : isDone ? '✓ Linked' : isOtherCard ? 'Steal' : 'Link'}
        </button>
      </div>
      {error && <div className="text-[10px] text-red-600 mt-0.5">{error}</div>}
    </div>
  )
}
