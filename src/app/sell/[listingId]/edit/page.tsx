'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { GRADING_SCALES, PHOTO_SLOTS, type GradingCompany, type PhotoSlotKey, type PhotoSlotMap, type Listing } from '@/types/database'

// Only allow grades 8 or higher for listings
function isGradeEligible(grade: string): boolean {
  if (grade === 'Black Label 10' || grade === 'Pristine 10') return true
  const num = parseFloat(grade)
  return !isNaN(num) && num >= 8
}

// Client-side image compression via Canvas
async function compressImage(file: File): Promise<Blob> {
  const MAX_SIZE = 1600
  const QUALITY = 0.85

  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => {
      let { width, height } = img
      if (width > MAX_SIZE || height > MAX_SIZE) {
        const ratio = Math.min(MAX_SIZE / width, MAX_SIZE / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(img.src)
          blob ? resolve(blob) : reject(new Error('Compression failed'))
        },
        'image/jpeg',
        QUALITY,
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(img.src)
      reject(new Error('Failed to load image'))
    }
    img.src = URL.createObjectURL(file)
  })
}

export default function EditListingPage() {
  const [listing, setListing] = useState<Listing | null>(null)
  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('')
  const [isGraded, setIsGraded] = useState(false)
  const [gradingCompany, setGradingCompany] = useState<GradingCompany | null>(null)
  const [grade, setGrade] = useState('')
  const [showAllGrades, setShowAllGrades] = useState(false)
  const [language, setLanguage] = useState('EN')
  const [marketPrice, setMarketPrice] = useState<number | null>(null)
  const emptyPhotos = Object.fromEntries(PHOTO_SLOTS.map(s => [s.key, null])) as PhotoSlotMap
  const [photos, setPhotos] = useState<PhotoSlotMap>(emptyPhotos)
  const [photoUploading, setPhotoUploading] = useState<Record<string, boolean>>({})
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
      if (l.grading_company) {
        setIsGraded(true)
        setGradingCompany(l.grading_company)
        setGrade(l.grade || '')
      }
      setLanguage(l.language)

      // Load existing photos into slot map
      if (l.photo_urls?.length) {
        const loaded = { ...emptyPhotos } as PhotoSlotMap
        l.photo_urls.forEach((url, i) => {
          if (i < PHOTO_SLOTS.length && url) {
            loaded[PHOTO_SLOTS[i].key] = url
          }
        })
        setPhotos(loaded)
      }

      // Fetch card market price for reference
      try {
        const cardRes = await fetch(`/api/cards?id=${encodeURIComponent(l.card_id)}`)
        const cardData = await cardRes.json()
        if (cardData.card?.price?.marketPrice) {
          setMarketPrice(cardData.card.price.marketPrice)
        }
      } catch { /* market price is optional */ }

      setLoading(false)
    }
    load()
  }, [supabase, router, listingId])

  async function handlePhotoUpload(slot: PhotoSlotKey, file: File) {
    setPhotoUploading(prev => ({ ...prev, [slot]: true }))
    try {
      const compressed = await compressImage(file)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const path = `${user.id}/${Date.now()}_${slot}.jpg`
      const { error: uploadError } = await supabase.storage
        .from('listing-photos')
        .upload(path, compressed, { contentType: 'image/jpeg', upsert: false })
      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage
        .from('listing-photos')
        .getPublicUrl(path)
      setPhotos(prev => ({ ...prev, [slot]: publicUrl }))
    } catch (err) {
      console.error('Photo upload failed:', err)
      alert('Photo upload failed. Please try again.')
    } finally {
      setPhotoUploading(prev => ({ ...prev, [slot]: false }))
    }
  }

  function handlePhotoRemove(slot: PhotoSlotKey) {
    setPhotos(prev => ({ ...prev, [slot]: null }))
  }

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
        condition: 'near_mint',
        grading_company: isGraded ? gradingCompany : null,
        grade: isGraded ? grade : null,
        language,
        photo_urls: isGraded ? [] : PHOTO_SLOTS.map(s => photos[s.key]).filter(Boolean),
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
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  if (!listing) return null

  return (
    <div className="max-w-2xl mx-auto">
      <Link href="/dashboard" className="text-sm text-zinc-500 hover:text-zinc-700 mb-4 inline-block">
        &larr; Back to Dashboard
      </Link>

      <h1 className="text-3xl font-bold text-zinc-900 mb-2">Edit Listing</h1>
      <p className="text-zinc-500 mb-8">
        <Link href={`/card/${listing.card_id.toLowerCase()}`} className="text-orange-400 hover:text-orange-600">
          {listing.title || listing.card_id}
        </Link>
      </p>

      {listing.status === 'delisted' && (
        <div className="p-4 bg-white border border-yellow-200 rounded-lg mb-6 flex items-center justify-between">
          <p className="text-yellow-400 text-sm">This listing is delisted and not visible to buyers.</p>
          <button
            onClick={relistListing}
            className="px-3 py-1 rounded bg-orange-500 hover:bg-orange-500 text-white text-sm font-medium transition-colors cursor-pointer"
          >
            Relist
          </button>
        </div>
      )}

      {listing.status === 'sold' && (
        <div className="p-4 bg-white border border-zinc-200 rounded-lg mb-6">
          <p className="text-zinc-500 text-sm">This listing has been sold and cannot be edited.</p>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-200 text-red-400 text-sm mb-6">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Card Type: Raw / Graded */}
        <div>
          <label className="block text-sm font-medium text-zinc-600 mb-1.5">Card Type</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setIsGraded(false)}
              disabled={listing.status === 'sold'}
              className={`px-4 py-3 rounded-lg text-sm font-medium transition-all cursor-pointer disabled:opacity-50 ${
                !isGraded
                  ? 'bg-orange-500 text-white ring-2 ring-orange-500 ring-offset-2'
                  : 'bg-zinc-100 text-zinc-700 border border-zinc-200 hover:border-orange-300'
              }`}
            >
              Raw
            </button>
            <button
              type="button"
              onClick={() => setIsGraded(true)}
              disabled={listing.status === 'sold'}
              className={`px-4 py-3 rounded-lg text-sm font-medium transition-all cursor-pointer disabled:opacity-50 ${
                isGraded
                  ? 'bg-orange-500 text-white ring-2 ring-orange-500 ring-offset-2'
                  : 'bg-zinc-100 text-zinc-700 border border-zinc-200 hover:border-orange-300'
              }`}
            >
              Graded
            </button>
          </div>
        </div>

        {/* Raw cards are always Near Mint */}
        {!isGraded && (
          <div className="px-4 py-3 rounded-lg bg-green-50 border border-green-200">
            <span className="text-sm font-medium text-green-700">Condition: Near Mint (NM)</span>
          </div>
        )}

        {/* Grading company + grade (graded only) */}
        {isGraded && (
          <>
            <div>
              <label className="block text-sm font-medium text-zinc-600 mb-1.5">Grading Company</label>
              <div className="grid grid-cols-4 gap-3">
                {(['PSA', 'CGC', 'BGS', 'TAG'] as GradingCompany[]).map((company) => (
                  <button
                    key={company}
                    type="button"
                    onClick={() => { setGradingCompany(company); setGrade('') }}
                    disabled={listing.status === 'sold'}
                    className={`px-4 py-3 rounded-lg text-sm font-medium transition-all cursor-pointer disabled:opacity-50 ${
                      gradingCompany === company
                        ? 'bg-orange-500 text-white ring-2 ring-orange-500 ring-offset-2'
                        : 'bg-zinc-100 text-zinc-700 border border-zinc-200 hover:border-orange-300'
                    }`}
                  >
                    {company}
                  </button>
                ))}
              </div>
            </div>
            {gradingCompany && (
              <div>
                <label className="block text-sm font-medium text-zinc-600 mb-1.5">Grade</label>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {(showAllGrades ? GRADING_SCALES[gradingCompany] : GRADING_SCALES[gradingCompany].filter(isGradeEligible)).map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGrade(g)}
                      disabled={listing.status === 'sold'}
                      className={`px-3 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer disabled:opacity-50 ${
                        grade === g
                          ? 'bg-orange-500 text-white ring-2 ring-orange-500 ring-offset-2'
                          : 'bg-zinc-100 text-zinc-700 border border-zinc-200 hover:border-orange-300'
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
                {!showAllGrades && (
                  <button
                    type="button"
                    onClick={() => setShowAllGrades(true)}
                    className="mt-2 text-xs text-zinc-400 hover:text-zinc-600 transition-colors cursor-pointer"
                  >
                    Show lower grades &darr;
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {/* Photos (raw cards only) */}
        {!isGraded && listing.status !== 'sold' && (
          <div>
            <label className="block text-sm font-medium text-zinc-600 mb-2">
              Photos
              <span className="ml-2 text-xs text-zinc-400 font-normal">
                {Object.values(photos).filter(Boolean).length}/10
              </span>
            </label>
            <div className="grid grid-cols-5 gap-2">
              {PHOTO_SLOTS.map(slot => {
                const url = photos[slot.key]
                const isUp = photoUploading[slot.key]

                return (
                  <label
                    key={slot.key}
                    className={`relative aspect-square rounded-lg border-2 border-dashed transition-all cursor-pointer overflow-hidden flex items-center justify-center ${
                      url
                        ? 'border-green-300 bg-green-50'
                        : isUp
                          ? 'border-orange-300 bg-orange-50'
                          : 'border-zinc-200 bg-zinc-50 hover:border-orange-300'
                    }`}
                  >
                    {url ? (
                      <>
                        <Image src={url} alt={slot.label} fill className="object-cover" sizes="100px" unoptimized />
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); handlePhotoRemove(slot.key) }}
                          className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 hover:bg-black/80 rounded-full flex items-center justify-center text-white z-10"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </>
                    ) : isUp ? (
                      <svg className="animate-spin h-4 w-4 text-orange-500" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <div className="text-center">
                        <svg className="w-4 h-4 text-zinc-300 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                        <p className="text-[9px] text-zinc-400 mt-0.5 leading-tight">{slot.label}</p>
                      </div>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) handlePhotoUpload(slot.key, file)
                        e.target.value = ''
                      }}
                    />
                  </label>
                )
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-zinc-600 mb-1.5">Price ($)</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={price}
              onChange={e => setPrice(e.target.value)}
              disabled={listing.status === 'sold'}
              required
              className="w-full px-4 py-3 rounded-lg bg-zinc-100 border border-zinc-200 text-zinc-900 disabled:opacity-50"
            />
            {marketPrice != null && (
              <div className="mt-1.5 flex items-center gap-2">
                <span className="text-xs text-zinc-400">Market: ${marketPrice.toFixed(2)}</span>
                <button
                  type="button"
                  onClick={() => setPrice(marketPrice.toFixed(2))}
                  disabled={listing.status === 'sold'}
                  className="text-xs text-orange-500 hover:text-orange-600 cursor-pointer disabled:opacity-50"
                >
                  Match
                </button>
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-600 mb-1.5">Quantity Available</label>
            <input
              type="number"
              min="1"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              disabled={listing.status === 'sold'}
              required
              className="w-full px-4 py-3 rounded-lg bg-zinc-100 border border-zinc-200 text-zinc-900 disabled:opacity-50"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-600 mb-1.5">Language</label>
          <select
            value={language}
            onChange={e => setLanguage(e.target.value)}
            disabled={listing.status === 'sold'}
            className="w-full px-4 py-3 rounded-lg bg-zinc-100 border border-zinc-200 text-zinc-900 disabled:opacity-50"
          >
            <option value="EN">English</option>
            <option value="JP">Japanese</option>
          </select>
        </div>

        <div className="flex items-center gap-3 pt-2">
          {listing.status !== 'sold' && (
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-3 rounded-lg bg-orange-500 hover:bg-orange-500 text-white font-semibold transition-colors cursor-pointer disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          )}
          {listing.status === 'active' && (
            <button
              type="button"
              onClick={delistListing}
              className="px-6 py-3 rounded-lg border border-red-200 text-red-400 hover:bg-red-50 font-semibold transition-colors cursor-pointer"
            >
              Delist
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
