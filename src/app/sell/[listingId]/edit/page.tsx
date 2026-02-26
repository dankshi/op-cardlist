'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { CONDITION_LABELS, type CardCondition, type Listing } from '@/types/database'

export default function EditListingPage() {
  const [listing, setListing] = useState<Listing | null>(null)
  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('')
  const [condition, setCondition] = useState<CardCondition>('near_mint')
  const [description, setDescription] = useState('')
  const [language, setLanguage] = useState('EN')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const params = useParams()
  const listingId = params.listingId as string
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth/sign-in'); return }

      const { data } = await supabase
        .from('listings')
        .select('*')
        .eq('id', listingId)
        .single()

      if (!data || data.seller_id !== user.id) {
        router.push('/dashboard')
        return
      }

      const l = data as Listing
      setListing(l)
      setPrice(String(l.price))
      setQuantity(String(l.quantity_available))
      setCondition(l.condition)
      setDescription(l.description || '')
      setLanguage(l.language)
      setLoading(false)
    }
    load()
  }, [supabase, router, listingId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!listing) return
    setSaving(true)
    setError('')

    const priceNum = parseFloat(price)
    const qtyNum = parseInt(quantity)

    if (!priceNum || priceNum <= 0) { setError('Enter a valid price'); setSaving(false); return }
    if (!qtyNum || qtyNum <= 0) { setError('Enter a valid quantity'); setSaving(false); return }

    const { error: updateError } = await supabase
      .from('listings')
      .update({
        price: priceNum,
        quantity_available: qtyNum,
        quantity: Math.max(listing.quantity, qtyNum),
        condition,
        description: description || null,
        language,
      })
      .eq('id', listing.id)

    if (updateError) {
      setError(updateError.message)
      setSaving(false)
      return
    }

    router.push('/dashboard')
  }

  async function delistListing() {
    if (!listing || !confirm('Delist this card? It will no longer be visible to buyers.')) return

    await supabase
      .from('listings')
      .update({ status: 'delisted' })
      .eq('id', listing.id)

    router.push('/dashboard')
  }

  async function relistListing() {
    if (!listing) return

    await supabase
      .from('listings')
      .update({ status: 'active' })
      .eq('id', listing.id)

    setListing({ ...listing, status: 'active' })
  }

  if (loading) {
    return (
      <div className="py-20 text-center">
        <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  if (!listing) return null

  return (
    <div className="max-w-2xl mx-auto">
      <Link href="/dashboard" className="text-sm text-zinc-400 light:text-gray-500 hover:text-zinc-200 light:hover:text-gray-700 mb-4 inline-block">
        &larr; Back to Dashboard
      </Link>

      <h1 className="text-3xl font-bold text-zinc-100 light:text-gray-900 mb-2">Edit Listing</h1>
      <p className="text-zinc-400 light:text-gray-500 mb-8">
        <Link href={`/card/${listing.card_id.toLowerCase()}`} className="text-sky-400 hover:text-sky-300 light:hover:text-sky-600">
          {listing.title || listing.card_id}
        </Link>
      </p>

      {listing.status === 'delisted' && (
        <div className="p-4 bg-zinc-900 light:bg-white border border-yellow-600/30 light:border-yellow-200 rounded-lg mb-6 flex items-center justify-between">
          <p className="text-yellow-400 text-sm">This listing is delisted and not visible to buyers.</p>
          <button
            onClick={relistListing}
            className="px-3 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium transition-colors cursor-pointer"
          >
            Relist
          </button>
        </div>
      )}

      {listing.status === 'sold' && (
        <div className="p-4 bg-zinc-900 light:bg-white border border-zinc-800 light:border-gray-200 rounded-lg mb-6">
          <p className="text-zinc-400 light:text-gray-500 text-sm">This listing has been sold and cannot be edited.</p>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 light:border-red-200 text-red-400 text-sm mb-6">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-zinc-300 light:text-gray-600 mb-1.5">Condition</label>
          <select
            value={condition}
            onChange={e => setCondition(e.target.value as CardCondition)}
            disabled={listing.status === 'sold'}
            className="w-full px-4 py-3 rounded-lg bg-zinc-800 light:bg-gray-100 border border-zinc-700 light:border-gray-300 text-zinc-100 light:text-gray-900 disabled:opacity-50"
          >
            {Object.entries(CONDITION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-zinc-300 light:text-gray-600 mb-1.5">Price ($)</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={price}
              onChange={e => setPrice(e.target.value)}
              disabled={listing.status === 'sold'}
              required
              className="w-full px-4 py-3 rounded-lg bg-zinc-800 light:bg-gray-100 border border-zinc-700 light:border-gray-300 text-zinc-100 light:text-gray-900 disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-300 light:text-gray-600 mb-1.5">Quantity Available</label>
            <input
              type="number"
              min="1"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              disabled={listing.status === 'sold'}
              required
              className="w-full px-4 py-3 rounded-lg bg-zinc-800 light:bg-gray-100 border border-zinc-700 light:border-gray-300 text-zinc-100 light:text-gray-900 disabled:opacity-50"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-300 light:text-gray-600 mb-1.5">Language</label>
          <select
            value={language}
            onChange={e => setLanguage(e.target.value)}
            disabled={listing.status === 'sold'}
            className="w-full px-4 py-3 rounded-lg bg-zinc-800 light:bg-gray-100 border border-zinc-700 light:border-gray-300 text-zinc-100 light:text-gray-900 disabled:opacity-50"
          >
            <option value="EN">English</option>
            <option value="JP">Japanese</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-300 light:text-gray-600 mb-1.5">Description (optional)</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
            disabled={listing.status === 'sold'}
            placeholder="Any additional details..."
            className="w-full px-4 py-3 rounded-lg bg-zinc-800 light:bg-gray-100 border border-zinc-700 light:border-gray-300 text-zinc-100 light:text-gray-900 placeholder-zinc-500 light:placeholder-gray-400 resize-none disabled:opacity-50"
          />
        </div>

        <div className="flex items-center gap-3 pt-2">
          {listing.status !== 'sold' && (
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-3 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold transition-colors cursor-pointer disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          )}
          {listing.status === 'active' && (
            <button
              type="button"
              onClick={delistListing}
              className="px-6 py-3 rounded-lg border border-red-800 light:border-red-300 text-red-400 hover:bg-red-500/10 light:hover:bg-red-50 font-semibold transition-colors cursor-pointer"
            >
              Delist
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
