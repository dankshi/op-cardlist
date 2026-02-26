'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { SubmitButton, AuthError } from '@/components/auth/AuthForm'
import { CONDITION_LABELS, type CardCondition } from '@/types/database'

interface CardResult {
  id: string
  name: string
  setId: string
  rarity: string
  imageUrl: string
}

export default function SellPage() {
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<CardResult[]>([])
  const [selectedCard, setSelectedCard] = useState<CardResult | null>(null)
  const [condition, setCondition] = useState<CardCondition>('near_mint')
  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [description, setDescription] = useState('')
  const [language, setLanguage] = useState('EN')
  const [searching, setSearching] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  // Check auth
  useEffect(() => {
    async function checkAuth() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/auth/sign-in')
        return
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_seller, seller_approved')
        .eq('id', user.id)
        .single()

      if (!profile?.is_seller || !profile?.seller_approved) {
        router.push('/seller/apply')
      }
    }
    checkAuth()
  }, [supabase, router])

  // Search cards
  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([])
      return
    }
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/cards?search=${encodeURIComponent(searchQuery)}`)
        const data = await res.json()
        setSearchResults((data.cards || data || []).slice(0, 20))
      } catch {
        setSearchResults([])
      }
      setSearching(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedCard || !price) return

    setPending(true)
    setError('')

    const title = `${selectedCard.name} (${selectedCard.id}) - ${CONDITION_LABELS[condition]}`

    const res = await fetch('/api/listings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        card_id: selectedCard.id,
        title,
        description: description || null,
        condition,
        price: parseFloat(price),
        quantity: parseInt(quantity),
        language,
      }),
    })

    if (!res.ok) {
      const data = await res.json()
      setError(data.error || 'Failed to create listing')
      setPending(false)
    } else {
      router.push('/dashboard')
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold text-zinc-100 light:text-gray-900 mb-8">Sell a Card</h1>

      <div className="bg-zinc-900 light:bg-white border border-zinc-800 light:border-gray-200 rounded-2xl p-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          <AuthError message={error} />

          {/* Card Search */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 light:text-gray-600 mb-1.5">
              Select Card
            </label>
            {selectedCard ? (
              <div className="flex items-center gap-4 p-3 rounded-lg bg-zinc-800 light:bg-gray-100 border border-zinc-700 light:border-gray-300">
                <img src={selectedCard.imageUrl} alt="" className="w-16 h-22 object-contain rounded" />
                <div>
                  <p className="font-medium text-zinc-100 light:text-gray-900">{selectedCard.name}</p>
                  <p className="text-sm text-zinc-400 light:text-gray-500">{selectedCard.id} &middot; {selectedCard.rarity}</p>
                </div>
                <button
                  type="button"
                  onClick={() => { setSelectedCard(null); setSearchQuery('') }}
                  className="ml-auto text-zinc-500 light:text-gray-400 hover:text-zinc-300 light:hover:text-gray-600 cursor-pointer"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by card name or ID..."
                  className="w-full px-4 py-3 rounded-lg bg-zinc-800 light:bg-gray-100 border border-zinc-700 light:border-gray-300 text-zinc-100 light:text-gray-900 placeholder-zinc-500 light:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                {searching && <p className="text-sm text-zinc-500 light:text-gray-400 mt-1">Searching...</p>}
                {searchResults.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-zinc-800 light:bg-gray-100 border border-zinc-700 light:border-gray-300 rounded-lg shadow-xl max-h-60 overflow-y-auto">
                    {searchResults.map((card) => (
                      <button
                        key={card.id}
                        type="button"
                        onClick={() => { setSelectedCard(card); setSearchResults([]) }}
                        className="w-full flex items-center gap-3 px-4 py-2 hover:bg-zinc-700 light:hover:bg-gray-100 transition-colors cursor-pointer text-left"
                      >
                        <img src={card.imageUrl} alt="" className="w-10 h-14 object-contain rounded" />
                        <div>
                          <p className="text-sm font-medium text-zinc-100 light:text-gray-900">{card.name}</p>
                          <p className="text-xs text-zinc-400 light:text-gray-500">{card.id} &middot; {card.rarity}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Condition */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 light:text-gray-600 mb-1.5">Condition</label>
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value as CardCondition)}
              className="w-full px-4 py-3 rounded-lg bg-zinc-800 light:bg-gray-100 border border-zinc-700 light:border-gray-300 text-zinc-100 light:text-gray-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              {Object.entries(CONDITION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {/* Price + Quantity */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-zinc-300 light:text-gray-600 mb-1.5">Price (USD)</label>
              <div className="relative">
                <span className="absolute left-3 top-3 text-zinc-500 light:text-gray-400">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  required
                  placeholder="0.00"
                  className="w-full pl-7 pr-4 py-3 rounded-lg bg-zinc-800 light:bg-gray-100 border border-zinc-700 light:border-gray-300 text-zinc-100 light:text-gray-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300 light:text-gray-600 mb-1.5">Quantity</label>
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-zinc-800 light:bg-gray-100 border border-zinc-700 light:border-gray-300 text-zinc-100 light:text-gray-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>

          {/* Language */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 light:text-gray-600 mb-1.5">Language</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-zinc-800 light:bg-gray-100 border border-zinc-700 light:border-gray-300 text-zinc-100 light:text-gray-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="EN">English</option>
              <option value="JP">Japanese</option>
            </select>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 light:text-gray-600 mb-1.5">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Any additional notes about the card..."
              className="w-full px-4 py-3 rounded-lg bg-zinc-800 light:bg-gray-100 border border-zinc-700 light:border-gray-300 text-zinc-100 light:text-gray-900 placeholder-zinc-500 light:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none"
            />
          </div>

          <SubmitButton pending={pending}>List Card for Sale</SubmitButton>
        </form>
      </div>
    </div>
  )
}
