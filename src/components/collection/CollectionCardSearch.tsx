'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'

export interface CardPick {
  id: string
  name: string
  rarity: string
  imageUrl: string
}

/** Full-width card typeahead for the collection add/edit modal. Same
 *  /api/cards?search=&mode=name endpoint as the sell wizard, but WITHOUT the
 *  sell-eligibility rarity filter — collectors own commons too. */
export function CollectionCardSearch({
  value,
  onSelect,
}: {
  value: CardPick | null
  onSelect: (card: CardPick | null) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CardPick[]>([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const q = query.trim()
    const timer = setTimeout(async () => {
      if (q.length < 2) { setResults([]); return }
      setSearching(true)
      try {
        const res = await fetch(`/api/cards?search=${encodeURIComponent(q)}&mode=name`)
        const data = await res.json()
        setResults(((data.cards || []) as CardPick[]).slice(0, 12))
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
      <div className="flex items-center gap-3 rounded-lg ring-1 ring-zinc-200 p-2.5">
        <div className="relative w-10 h-14 shrink-0 rounded bg-zinc-100 overflow-hidden">
          {value.imageUrl && <Image src={value.imageUrl} alt="" fill sizes="40px" className="object-cover" unoptimized />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-900 truncate">{value.name}</p>
          <p className="text-[11px] text-zinc-400 font-mono">{value.id} · {value.rarity}</p>
        </div>
        <button
          type="button"
          onClick={() => { setQuery(''); onSelect(null) }}
          className="text-zinc-400 hover:text-zinc-700 text-sm cursor-pointer px-2"
          title="Change card"
        >
          Change
        </button>
      </div>
    )
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder="Search a card by name…"
        className="w-full px-3 py-2.5 rounded-lg border-2 border-zinc-200 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-orange-500"
      />
      {open && query.trim().length >= 2 && (
        <div className="absolute z-30 left-0 right-0 mt-1 max-h-72 overflow-y-auto bg-white border border-zinc-200 rounded-lg shadow-lg">
          {searching && <p className="px-3 py-2 text-xs text-zinc-400">Searching…</p>}
          {!searching && results.length === 0 && <p className="px-3 py-2 text-xs text-zinc-400">No cards found.</p>}
          {results.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => { onSelect(c); setOpen(false); setQuery('') }}
              className="flex items-center gap-2 w-full px-2 py-1.5 text-left hover:bg-zinc-50"
            >
              <div className="relative w-7 h-10 shrink-0 rounded bg-zinc-100 overflow-hidden">
                {c.imageUrl && <Image src={c.imageUrl} alt="" fill sizes="28px" className="object-cover" unoptimized />}
              </div>
              <div className="min-w-0">
                <p className="text-sm text-zinc-900 truncate">{c.name}</p>
                <p className="text-[10px] text-zinc-400 font-mono">{c.id} · {c.rarity}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
