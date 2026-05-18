'use client'

/* eslint-disable @next/next/no-img-element */
import { useState } from 'react'
import Link from 'next/link'
import { HoverThumb } from './HoverThumb'

interface Props {
  specId: number
  cardId: string
  cardImageUrl: string | null
  rarity: string | null
  artStyle: string | null
  claimedBy: number | null
  claimedLabel: string | null
  /** Whether this thumb is the most recently successfully-assigned one
   *  in its candidate group. Controlled by PsaCandidateGroup so that
   *  clicking a different sibling resets this one's checkmark. */
  isActive?: boolean
  /** Fires after a successful POST so the parent can update which thumb
   *  is the "active" assigned one. */
  onAssigned?: () => void
}

/** Candidate tile for the PSA admin page. Click the image to assign this
 *  card_id to the PSA spec. PATCH /api/admin/pops-psa/[specId] writes the
 *  mapping; the tile dims to indicate "done" without triggering a page
 *  refresh (admin can keep scanning the rest of the section). */
export function PsaAssignThumb({ specId, cardId, cardImageUrl, rarity, artStyle, claimedBy, claimedLabel, isActive, onAssigned }: Props) {
  const [state, setState] = useState<'idle' | 'pending'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault()
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
      setState('idle')
      onAssigned?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
      setState('idle')
    }
  }

  const isDone = isActive === true
  const isPending = state === 'pending'

  return (
    <div className={`w-20 text-[10px] ${claimedBy && !isDone ? 'opacity-60' : ''} ${isDone ? 'ring-2 ring-emerald-400 rounded' : ''}`}>
      {cardImageUrl ? (
        <button
          type="button"
          onClick={handleClick}
          disabled={isPending || isDone}
          className="block w-full cursor-pointer disabled:cursor-default"
          title={isDone ? 'Assigned ✓' : `Click to link spec ${specId} → ${cardId}`}
        >
          <HoverThumb src={cardImageUrl} alt={cardId} />
        </button>
      ) : (
        <div className="w-full aspect-[5/7] bg-zinc-100 rounded border border-zinc-200 flex items-center justify-center text-zinc-400">
          no img
        </div>
      )}
      <div className="font-mono truncate mt-0.5">
        <Link className="text-blue-600 hover:underline" href={`/card/${cardId}`}>{cardId}</Link>
      </div>
      <div className="text-zinc-400">{rarity ?? '-'} · {artStyle ?? '-'}</div>
      {isDone ? (
        <div className="text-emerald-700 text-[9px] font-semibold mt-0.5">✓ Assigned</div>
      ) : claimedBy ? (
        <div className="mt-0.5 text-amber-700" title={claimedLabel ?? undefined}>
          <div className="text-[9px] uppercase tracking-wide">used by</div>
          <div className="truncate font-medium">{claimedLabel}</div>
          <a
            href={`https://www.psacard.com/spec/psa/${claimedBy}`}
            target="_blank"
            rel="noreferrer"
            className="text-[9px] hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            spec {claimedBy}↗
          </a>
        </div>
      ) : null}
      {isPending && <div className="text-zinc-500 text-[9px] mt-0.5">…</div>}
      {error && <div className="text-red-600 text-[9px] mt-0.5">{error}</div>}
    </div>
  )
}
