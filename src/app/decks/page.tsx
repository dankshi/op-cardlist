'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Deck } from '@/types/database'

export default function DecksPage() {
  const [myDecks, setMyDecks] = useState<Deck[]>([])
  const [publicDecks, setPublicDecks] = useState<Deck[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'my' | 'public'>('my')
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()

      if (user) {
        const { data } = await supabase
          .from('decks')
          .select('*')
          .eq('user_id', user.id)
          .order('updated_at', { ascending: false })
        setMyDecks((data as Deck[]) || [])
      } else {
        setTab('public')
      }

      const { data: pub } = await supabase
        .from('decks')
        .select('*, user:profiles(display_name, username)')
        .eq('is_public', true)
        .order('view_count', { ascending: false })
        .limit(50)
      setPublicDecks((pub as Deck[]) || [])

      setLoading(false)
    }
    load()
  }, [supabase, router])

  if (loading) {
    return (
      <div className="py-20 text-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  const decks = tab === 'my' ? myDecks : publicDecks

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-zinc-900">Decks</h1>
        <Link
          href="/decks/new"
          className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-500 text-white font-semibold transition-colors"
        >
          + New Deck
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-zinc-200">
        <button
          onClick={() => setTab('my')}
          className={`px-4 py-2 text-sm font-medium transition-colors cursor-pointer ${
            tab === 'my' ? 'text-orange-400 border-b-2 border-orange-400' : 'text-zinc-500 hover:text-zinc-700'
          }`}
        >
          My Decks
        </button>
        <button
          onClick={() => setTab('public')}
          className={`px-4 py-2 text-sm font-medium transition-colors cursor-pointer ${
            tab === 'public' ? 'text-orange-400 border-b-2 border-orange-400' : 'text-zinc-500 hover:text-zinc-700'
          }`}
        >
          Public Decks
        </button>
      </div>

      {decks.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-zinc-500 mb-4">
            {tab === 'my' ? "You haven't created any decks yet." : 'No public decks available.'}
          </p>
          {tab === 'my' && (
            <Link href="/decks/new" className="text-orange-400 hover:text-orange-600 font-medium">
              Create your first deck
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {decks.map(deck => (
            <Link
              key={deck.id}
              href={`/decks/${deck.id}`}
              className="block p-4 rounded-lg bg-white border border-zinc-200 hover:border-zinc-300 transition-colors"
            >
              <h3 className="font-medium text-zinc-900">{deck.name}</h3>
              {deck.description && <p className="text-sm text-zinc-500 mt-1 line-clamp-2">{deck.description}</p>}
              <div className="flex items-center gap-4 mt-3 text-xs text-zinc-500">
                {deck.leader_card_id && <span>Leader: {deck.leader_card_id}</span>}
                <span>{deck.view_count} views</span>
                {deck.is_public && <span className="text-green-400">Public</span>}
              </div>
              {tab === 'public' && deck.user && (
                <p className="text-xs text-zinc-500 mt-2">
                  by {(deck.user as { display_name: string }).display_name}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
