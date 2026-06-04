'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'

export interface CardPick {
  id: string
  name: string
  rarity: string
  imageUrl: string
}

// Mirrors the eligibility rule in the /sell wizard: only Rare-and-above
// rarities (or parallels) can be listed.
const SELL_RARITIES = new Set(['L', 'SEC', 'SP', 'SR', 'R', 'TR', 'P'])

/** Compact typeahead for picking a card in a single table row. Hits the
 *  same /api/cards?search=&mode=name endpoint the /sell wizard uses. */
export function CardSearchCell({
  value,
  onSelect,
}: {
  value: CardPick | null
  onSelect: (card: CardPick) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CardPick[]>([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const q = query.trim()
    // All state writes happen inside the debounce callback (not synchronously
    // in the effect body) so we don't trigger cascading renders on every keystroke.
    const timer = setTimeout(async () => {
      if (q.length < 2) { setResults([]); return }
      setSearching(true)
      try {
        const res = await fetch(`/api/cards?search=${encodeURIComponent(q)}&mode=name`)
        const data = await res.json()
        const all = (data.cards || []) as CardPick[]
        setResults(all.filter(c => SELL_RARITIES.has(c.rarity) || c.id.includes('_p')).slice(0, 12))
      } catch {
        setResults([])
      }
      setSearching(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  if (value) {
    return (
      <div className="flex items-center gap-2 min-w-[200px]">
        <div className="relative w-7 h-10 shrink-0 rounded bg-zinc-100 overflow-hidden">
          {value.imageUrl && <Image src={value.imageUrl} alt="" fill sizes="28px" className="object-cover" unoptimized />}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-900 truncate max-w-[160px]">{value.name}</p>
          <p className="text-[10px] text-zinc-400">{value.id} · {value.rarity}</p>
        </div>
        <button
          type="button"
          onClick={() => { setQuery(''); onSelect({ id: '', name: '', rarity: '', imageUrl: '' }) }}
          className="ml-auto text-zinc-400 hover:text-zinc-700 text-xs cursor-pointer"
          title="Change card"
        >
          ✕
        </button>
      </div>
    )
  }

  return (
    <div ref={wrapRef} className="relative min-w-[200px]">
      <input
        type="text"
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder="Search card…"
        className="w-full px-2 py-1.5 rounded border border-zinc-200 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
      />
      {open && (query.trim().length >= 2) && (
        <div className="absolute z-30 left-0 right-0 mt-1 max-h-72 overflow-y-auto bg-white border border-zinc-200 rounded-lg shadow-lg">
          {searching && <p className="px-3 py-2 text-xs text-zinc-400">Searching…</p>}
          {!searching && results.length === 0 && <p className="px-3 py-2 text-xs text-zinc-400">No eligible cards.</p>}
          {results.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => { onSelect(c); setOpen(false); setQuery('') }}
              className="flex items-center gap-2 w-full px-2 py-1.5 text-left hover:bg-zinc-50"
            >
              <div className="relative w-6 h-8 shrink-0 rounded bg-zinc-100 overflow-hidden">
                {c.imageUrl && <Image src={c.imageUrl} alt="" fill sizes="24px" className="object-cover" unoptimized />}
              </div>
              <div className="min-w-0">
                <p className="text-sm text-zinc-900 truncate">{c.name}</p>
                <p className="text-[10px] text-zinc-400">{c.id} · {c.rarity}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
