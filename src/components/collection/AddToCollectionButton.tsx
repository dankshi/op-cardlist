'use client'

import { useState } from 'react'
import { useToast } from '@/components/ui/Toaster'

/** Quick-add a card to the buyer's collection (raw, qty 1, no cost basis).
 *  `icon` variant is a compact overlay button for card tiles; `button` is a
 *  labeled button for the card detail page. Shows a bottom-right toast. */
export function AddToCollectionButton({
  cardId,
  cardName,
  variant = 'icon',
  onAdded,
}: {
  cardId: string
  cardName: string
  variant?: 'icon' | 'button' | 'minimal'
  /** Called after a successful add so an owning view (e.g. the card page's
   *  "In your collection" panel) can refresh its rows without a reload. */
  onAdded?: () => void
}) {
  const { show } = useToast()
  const [saving, setSaving] = useState(false)
  const [added, setAdded] = useState(false)

  async function add(e: React.MouseEvent) {
    // Tiles wrap the whole card in a <Link>; don't navigate on add.
    e.preventDefault()
    e.stopPropagation()
    if (saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_id: cardId, quantity: 1 }),
      })
      if (res.status === 401) {
        show('Sign in to save to your collection', { variant: 'error', href: '/auth/sign-in?redirect=/collection' })
        return
      }
      if (!res.ok) {
        show('Couldn’t add to collection', { variant: 'error' })
        return
      }
      setAdded(true)
      show(`Added ${cardName} to your collection`, { href: '/collection' })
      onAdded?.()
    } catch {
      show('Couldn’t add to collection', { variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  if (variant === 'minimal') {
    // Compact pill for the card-detail title line.
    return (
      <button
        type="button"
        onClick={add}
        disabled={saving}
        aria-label="Add to collection"
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium ring-1 ring-zinc-200 text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
      >
        {added ? (
          <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        )}
        {added ? 'Saved' : 'Collection'}
      </button>
    )
  }

  if (variant === 'button') {
    return (
      <button
        type="button"
        onClick={add}
        disabled={saving}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold ring-1 ring-zinc-300 text-zinc-700 hover:bg-zinc-50 transition-colors cursor-pointer disabled:opacity-50"
      >
        <PlusIcon />
        {added ? 'Added to collection' : 'Add to collection'}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={add}
      disabled={saving}
      title="Add to collection"
      aria-label="Add to collection"
      className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-black/65 text-white backdrop-blur-sm hover:bg-black/80 transition-colors cursor-pointer disabled:opacity-60"
    >
      {added ? (
        <svg className="w-4 h-4 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <PlusIcon />
      )}
    </button>
  )
}

function PlusIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  )
}
