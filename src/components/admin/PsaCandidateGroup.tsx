'use client'

import { useState } from 'react'
import { PsaAssignThumb } from './PsaAssignThumb'

interface CandidateData {
  id: string
  image_url: string | null
  rarity: string | null
  art_style: string | null
  claimedBy: number | null
  claimedLabel: string | null
}

interface Props {
  specId: number
  candidates: CandidateData[]
}

/** Wraps a row's candidate thumbnails so they share "last assigned"
 *  state. When the admin clicks one and then a different one (correcting
 *  a misclick), the first one's ✓ Assigned visual resets — only the most
 *  recently clicked thumb stays marked. */
export function PsaCandidateGroup({ specId, candidates }: Props) {
  // The card_id of the most recently successfully-assigned thumb. Other
  // thumbs in the group key off this to know whether to show ✓ Assigned
  // or fall back to their default state.
  const [activeCardId, setActiveCardId] = useState<string | null>(null)

  return (
    <>
      {candidates.map(c => (
        <PsaAssignThumb
          key={c.id}
          specId={specId}
          cardId={c.id}
          cardImageUrl={c.image_url}
          rarity={c.rarity}
          artStyle={c.art_style}
          claimedBy={c.claimedBy}
          claimedLabel={c.claimedLabel}
          isActive={activeCardId === c.id}
          onAssigned={() => setActiveCardId(c.id)}
        />
      ))}
    </>
  )
}
