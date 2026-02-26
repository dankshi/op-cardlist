'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Deck, DeckCard } from '@/types/database'

interface DeckCardInfo extends DeckCard {
  cardName?: string
  cardType?: string
  imageUrl?: string
}

export default function DeckViewPage() {
  const [deck, setDeck] = useState<Deck | null>(null)
  const [cards, setCards] = useState<DeckCardInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [isOwner, setIsOwner] = useState(false)
  const params = useParams()
  const deckId = params.deckId as string
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()

      const { data: deckData } = await supabase
        .from('decks')
        .select('*, user:profiles(display_name, username)')
        .eq('id', deckId)
        .single()

      if (!deckData) { setLoading(false); return }

      // Only show if public or owned by current user
      if (!deckData.is_public && deckData.user_id !== user?.id) {
        setLoading(false)
        return
      }

      setDeck(deckData as Deck)
      setIsOwner(user?.id === deckData.user_id)

      // Increment view count if not owner
      if (user?.id !== deckData.user_id) {
        await supabase
          .from('decks')
          .update({ view_count: (deckData.view_count || 0) + 1 })
          .eq('id', deckId)
      }

      // Get deck cards
      const { data: deckCards } = await supabase
        .from('deck_cards')
        .select('*')
        .eq('deck_id', deckId)
        .order('created_at')

      setCards((deckCards as DeckCardInfo[]) || [])
      setLoading(false)
    }
    load()
  }, [supabase, deckId])

  if (loading) {
    return (
      <div className="py-20 text-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  if (!deck) {
    return (
      <div className="max-w-3xl mx-auto text-center py-20">
        <h1 className="text-2xl font-bold text-zinc-900 mb-4">Deck not found</h1>
        <p className="text-zinc-500 mb-6">This deck may be private or doesn&apos;t exist.</p>
        <Link href="/decks" className="text-orange-400 hover:text-orange-600 font-medium">Browse Decks</Link>
      </div>
    )
  }

  const totalCards = cards.reduce((sum, c) => sum + c.quantity, 0)
  const mainDeck = cards.filter(c => !c.is_sideboard)
  const sideboard = cards.filter(c => c.is_sideboard)

  return (
    <div className="max-w-3xl mx-auto">
      <Link href="/decks" className="text-sm text-zinc-500 hover:text-zinc-700 mb-4 inline-block">
        &larr; Back to Decks
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900">{deck.name}</h1>
          {deck.user && (
            <p className="text-sm text-zinc-500 mt-1">
              by{' '}
              <Link href={`/seller/${(deck.user as { username: string }).username}`} className="text-orange-400 hover:text-orange-600">
                {(deck.user as { display_name: string }).display_name}
              </Link>
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {deck.is_public && <span className="text-xs px-2 py-1 rounded bg-green-500/10 text-green-400">Public</span>}
          <span className="text-sm text-zinc-500">{deck.view_count} views</span>
        </div>
      </div>

      {deck.description && (
        <p className="text-zinc-500 mb-6">{deck.description}</p>
      )}

      {/* Leader */}
      {deck.leader_card_id && (
        <div className="p-4 bg-white border border-zinc-200 rounded-lg mb-6">
          <h3 className="text-sm font-medium text-zinc-500 mb-2">Leader</h3>
          <Link href={`/card/${deck.leader_card_id.toLowerCase()}`} className="font-medium text-zinc-900 hover:text-orange-400 transition-colors">
            {deck.leader_card_id}
          </Link>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-zinc-200 rounded-lg p-3 text-center">
          <p className="text-xl font-bold text-zinc-900">{totalCards}</p>
          <p className="text-xs text-zinc-500">Cards</p>
        </div>
        <div className="bg-white border border-zinc-200 rounded-lg p-3 text-center">
          <p className="text-xl font-bold text-zinc-900">{mainDeck.length}</p>
          <p className="text-xs text-zinc-500">Unique</p>
        </div>
        <div className="bg-white border border-zinc-200 rounded-lg p-3 text-center">
          <p className="text-xl font-bold text-zinc-900">{sideboard.length}</p>
          <p className="text-xs text-zinc-500">Sideboard</p>
        </div>
      </div>

      {/* Main Deck */}
      {mainDeck.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-bold text-zinc-900 mb-3">Main Deck ({mainDeck.reduce((s, c) => s + c.quantity, 0)})</h2>
          <div className="space-y-1">
            {mainDeck.map(card => (
              <div key={card.id} className="flex items-center justify-between px-3 py-2 rounded bg-white border border-zinc-200">
                <div className="flex items-center gap-2">
                  <span className="text-orange-400 font-mono text-sm">{card.quantity}x</span>
                  <Link href={`/card/${card.card_id.toLowerCase()}`} className="text-zinc-900 text-sm hover:text-orange-400 transition-colors">
                    {card.card_id}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sideboard */}
      {sideboard.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-bold text-zinc-900 mb-3">Sideboard ({sideboard.reduce((s, c) => s + c.quantity, 0)})</h2>
          <div className="space-y-1">
            {sideboard.map(card => (
              <div key={card.id} className="flex items-center justify-between px-3 py-2 rounded bg-white border border-zinc-200">
                <div className="flex items-center gap-2">
                  <span className="text-orange-400 font-mono text-sm">{card.quantity}x</span>
                  <Link href={`/card/${card.card_id.toLowerCase()}`} className="text-zinc-900 text-sm hover:text-orange-400 transition-colors">
                    {card.card_id}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {cards.length === 0 && (
        <div className="text-center py-12">
          <p className="text-zinc-500">This deck has no cards yet.</p>
        </div>
      )}

      {/* Owner actions */}
      {isOwner && (
        <div className="flex gap-3 mt-8">
          <button
            onClick={async () => {
              await supabase.from('decks').update({ is_public: !deck.is_public }).eq('id', deck.id)
              setDeck({ ...deck, is_public: !deck.is_public })
            }}
            className="px-4 py-2 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 text-sm transition-colors cursor-pointer"
          >
            {deck.is_public ? 'Make Private' : 'Make Public'}
          </button>
          <button
            onClick={async () => {
              if (!confirm('Delete this deck?')) return
              await supabase.from('deck_cards').delete().eq('deck_id', deck.id)
              await supabase.from('decks').delete().eq('id', deck.id)
              window.location.href = '/decks'
            }}
            className="px-4 py-2 rounded-lg border border-red-200 text-red-400 hover:bg-red-50 text-sm transition-colors cursor-pointer"
          >
            Delete Deck
          </button>
        </div>
      )}
    </div>
  )
}
