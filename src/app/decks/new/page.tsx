'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { SubmitButton, AuthError } from '@/components/auth/AuthForm'

interface CardResult {
  id: string
  name: string
  type: string
  rarity: string
  imageUrl: string
}

interface DeckEntry {
  card: CardResult
  quantity: number
}

export default function NewDeckPage() {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  const [entries, setEntries] = useState<DeckEntry[]>([])
  const [leader, setLeader] = useState<CardResult | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<CardResult[]>([])
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function checkAuth() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) router.push('/auth/sign-in')
    }
    checkAuth()
  }, [supabase, router])

  // Search cards
  useEffect(() => {
    if (searchQuery.length < 2) { setSearchResults([]); return }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/cards?search=${encodeURIComponent(searchQuery)}`)
        const data = await res.json()
        setSearchResults((data.cards || data || []).slice(0, 15))
      } catch {
        setSearchResults([])
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  function addCard(card: CardResult) {
    if (card.type === 'LEADER') {
      setLeader(card)
      setSearchResults([])
      setSearchQuery('')
      return
    }

    const existing = entries.find(e => e.card.id === card.id)
    if (existing) {
      if (existing.quantity < 4) {
        setEntries(entries.map(e => e.card.id === card.id ? { ...e, quantity: e.quantity + 1 } : e))
      }
    } else {
      setEntries([...entries, { card, quantity: 1 }])
    }
    setSearchResults([])
    setSearchQuery('')
  }

  function removeCard(cardId: string) {
    setEntries(entries.filter(e => e.card.id !== cardId))
  }

  const totalCards = entries.reduce((sum, e) => sum + e.quantity, 0)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name) return
    setPending(true)
    setError('')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: deck, error: deckError } = await supabase
      .from('decks')
      .insert({
        user_id: user.id,
        name,
        description: description || null,
        leader_card_id: leader?.id || null,
        is_public: isPublic,
      })
      .select()
      .single()

    if (deckError || !deck) {
      setError(deckError?.message || 'Failed to create deck')
      setPending(false)
      return
    }

    if (entries.length > 0) {
      const deckCards = entries.map(e => ({
        deck_id: deck.id,
        card_id: e.card.id,
        quantity: e.quantity,
      }))
      await supabase.from('deck_cards').insert(deckCards)
    }

    router.push(`/decks/${deck.id}`)
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold text-zinc-900 mb-8">Build a Deck</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <AuthError message={error} />

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-zinc-600 mb-1.5">Deck Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              placeholder="My Red Luffy Deck"
              className="w-full px-4 py-3 rounded-lg bg-zinc-100 border border-zinc-200 text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-600 mb-1.5">Visibility</label>
            <label className="flex items-center gap-2 px-4 py-3 rounded-lg bg-zinc-100 border border-zinc-200 cursor-pointer">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={e => setIsPublic(e.target.checked)}
                className="rounded"
              />
              <span className="text-zinc-900 text-sm">Make public</span>
            </label>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-600 mb-1.5">Description (optional)</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={2}
            placeholder="Describe your deck strategy..."
            className="w-full px-4 py-3 rounded-lg bg-zinc-100 border border-zinc-200 text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
          />
        </div>

        {/* Leader */}
        <div className="p-4 bg-white border border-zinc-200 rounded-lg">
          <h3 className="text-sm font-medium text-zinc-600 mb-2">Leader</h3>
          {leader ? (
            <div className="flex items-center gap-3">
              <img src={leader.imageUrl} alt="" className="w-12 h-16 object-contain rounded" />
              <div>
                <p className="text-zinc-900 font-medium">{leader.name}</p>
                <p className="text-xs text-zinc-500">{leader.id}</p>
              </div>
              <button type="button" onClick={() => setLeader(null)} className="ml-auto text-zinc-500 hover:text-zinc-600 cursor-pointer text-sm">
                Change
              </button>
            </div>
          ) : (
            <p className="text-zinc-500 text-sm">Search below and click a LEADER card to set it</p>
          )}
        </div>

        {/* Card Search */}
        <div>
          <label className="block text-sm font-medium text-zinc-600 mb-1.5">
            Add Cards ({totalCards}/50)
          </label>
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search cards to add..."
              className="w-full px-4 py-3 rounded-lg bg-zinc-100 border border-zinc-200 text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
            {searchResults.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-zinc-100 border border-zinc-200 rounded-lg shadow-xl max-h-60 overflow-y-auto">
                {searchResults.map(card => (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => addCard(card)}
                    className="w-full flex items-center gap-3 px-4 py-2 hover:bg-zinc-100 text-left cursor-pointer"
                  >
                    <img src={card.imageUrl} alt="" className="w-8 h-11 object-contain rounded" />
                    <div>
                      <p className="text-sm text-zinc-900">{card.name}</p>
                      <p className="text-xs text-zinc-500">{card.id} &middot; {card.type} &middot; {card.rarity}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Deck list */}
        {entries.length > 0 && (
          <div className="space-y-1">
            {entries.map(entry => (
              <div key={entry.card.id} className="flex items-center justify-between px-3 py-2 rounded bg-zinc-100">
                <div className="flex items-center gap-2">
                  <span className="text-orange-400 font-mono text-sm">{entry.quantity}x</span>
                  <span className="text-zinc-900 text-sm">{entry.card.name}</span>
                  <span className="text-zinc-500 text-xs">{entry.card.id}</span>
                </div>
                <button type="button" onClick={() => removeCard(entry.card.id)} className="text-zinc-500 hover:text-red-500 cursor-pointer">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        <SubmitButton pending={pending}>Create Deck</SubmitButton>
      </form>
    </div>
  )
}
