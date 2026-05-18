'use client'

/* eslint-disable @next/next/no-img-element */
import { useState } from 'react'
import Link from 'next/link'
import { HoverThumb } from './HoverThumb'
import { AssignMappingButton } from './AssignMappingButton'
import { ManualUrlAssign } from './ManualUrlAssign'

interface Candidate {
  product_id: number
  product_name: string
  product_url_name: string | null
}

interface Props {
  cardId: string
  cardName: string
  cardRarity: string | null
  cardArtStyle: string | null
  imageUrl: string | null
  candidates: Candidate[]
  /** product_id currently mapped to this card (if any). Highlighted as
   *  "(current)" in the candidate list so admin sees what's there now. */
  currentProductId?: number
  /** Renderable note above the candidate list (e.g. "no candidates"). */
  emptyNote?: string
}

/** Card row in /admin/mappings that owns the "done" state for all its
 *  assign buttons. When the admin clicks Assign on ANY candidate, the
 *  whole tile dims so they know to move on — but it stays in place so
 *  the page doesn't shift under them. */
export function CardAssignmentTile({
  cardId, cardName, cardRarity, cardArtStyle, imageUrl, candidates, currentProductId, emptyNote,
}: Props) {
  const [done, setDone] = useState(false)

  return (
    <div className={`flex gap-3 text-xs border border-zinc-100 rounded p-2 transition-opacity ${done ? 'opacity-40' : ''}`}>
      <div className="w-20 flex-shrink-0">
        {imageUrl ? (
          <HoverThumb src={imageUrl} alt={cardName} />
        ) : (
          <div className="w-full aspect-[5/7] bg-zinc-100 rounded border border-zinc-200 flex items-center justify-center text-zinc-400 text-[10px]">
            no image
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-mono">
          <Link className="text-blue-600 hover:underline" href={`/card/${cardId}`}>{cardId}</Link>
        </div>
        <div className="text-zinc-700 truncate" title={cardName}>{cardName}</div>
        <div className="text-zinc-400 mb-1">{cardRarity ?? '-'} · {cardArtStyle ?? '-'}</div>
        {candidates.length === 0 ? (
          <div className="text-zinc-400 italic mb-1">{emptyNote ?? 'no candidates'}</div>
        ) : (
          <div className="space-y-0.5 mb-1">
            {candidates.map(p => {
              const isCurrent = p.product_id === currentProductId
              return (
                <div key={p.product_id} className={isCurrent ? 'bg-amber-50 rounded px-1 py-0.5 -mx-1' : ''}>
                  <AssignMappingButton
                    cardId={cardId}
                    productId={p.product_id}
                    productName={isCurrent ? `${p.product_name} (current)` : p.product_name}
                    productUrlName={p.product_url_name}
                    onDone={() => setDone(true)}
                  />
                </div>
              )
            })}
          </div>
        )}
        <ManualUrlAssign cardId={cardId} onDone={() => setDone(true)} />
      </div>
    </div>
  )
}
