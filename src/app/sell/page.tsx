'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { GRADING_SCALES, PHOTO_SLOTS, type GradingCompany, type PhotoSlotKey, type PhotoSlotMap } from '@/types/database'
import confetti from 'canvas-confetti'
import Image from 'next/image'

// ============================================
// Types
// ============================================

interface CardResult {
  id: string
  name: string
  setId: string
  rarity: string
  imageUrl: string
  price?: {
    marketPrice: number | null
    lowestPrice: number | null
  }
}

// Rarities eligible for selling (Rare and above)
const SELL_RARITIES = new Set(['L', 'SEC', 'SP', 'SR', 'R', 'TR', 'P'])

// Only allow grades 8 or higher for listings
function isGradeEligible(grade: string): boolean {
  if (grade === 'Black Label 10' || grade === 'Pristine 10') return true
  const num = parseFloat(grade)
  return !isNaN(num) && num >= 8
}

// Front / Back slot groups for photo upload
const FRONT_SLOTS = PHOTO_SLOTS.filter(s => s.key.startsWith('front'))
const BACK_SLOTS = PHOTO_SLOTS.filter(s => s.key.startsWith('back'))

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

// ============================================
// Bottom Step Indicator (minimal)
// ============================================

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/80 backdrop-blur-sm border-t border-zinc-200">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
        <span className="text-sm text-zinc-400">{current}/{total}</span>
        <div className="flex gap-1.5">
          {Array.from({ length: total }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-500 ${
                i < current ? 'w-6 bg-orange-500' : 'w-6 bg-zinc-200'
              }`}
            />
          ))}
        </div>
        <span className="text-sm text-zinc-400">{Math.round(((current - 1) / (total - 1)) * 100)}%</span>
      </div>
    </div>
  )
}

// ============================================
// Step 1: Search & Select Card
// ============================================

function StepSelectCard({
  selectedCard,
  onSelect,
}: {
  selectedCard: CardResult | null
  onSelect: (card: CardResult) => void
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<CardResult[]>([])
  const [searching, setSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)

  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([])
      setHasSearched(false)
      return
    }
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/cards?search=${encodeURIComponent(searchQuery)}&mode=name`)
        const data = await res.json()
        const all: CardResult[] = data.cards || data || []
        // Only show cards that are rare+ or parallels
        const eligible = all.filter(c => SELL_RARITIES.has(c.rarity) || c.id.includes('_p'))
        setSearchResults(eligible.slice(0, 40))
      } catch {
        setSearchResults([])
      }
      setSearching(false)
      setHasSearched(true)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  return (
    <div>
      <h2 className="text-2xl font-bold text-zinc-900 mb-1">Which card are you selling?</h2>
      <p className="text-zinc-500 mb-6">Search by name, card number, or set.</p>

      <div className="relative mb-6">
        <svg className="absolute left-3.5 top-3.5 w-5 h-5 text-zinc-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="e.g. Luffy, OP01-001, Straw Hat..."
          autoFocus
          className="w-full pl-11 pr-4 py-3.5 rounded-xl bg-zinc-100 border border-zinc-200 text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500 text-lg"
        />
        {searching && (
          <div className="absolute right-3.5 top-3.5">
            <svg className="animate-spin h-5 w-5 text-orange-500" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        )}
      </div>

      {/* Card Gallery Grid */}
      {searchResults.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {searchResults.map((card) => (
            <button
              key={card.id}
              type="button"
              onClick={() => onSelect(card)}
              className={`group relative rounded-xl overflow-hidden transition-all duration-200 cursor-pointer ${
                selectedCard?.id === card.id
                  ? 'ring-3 ring-orange-500 scale-[1.02]'
                  : 'hover:ring-2 hover:ring-orange-300 hover:scale-[1.02]'
              }`}
            >
              <div className="aspect-[2.5/3.5] relative bg-zinc-100">
                <Image
                  src={card.imageUrl}
                  alt={card.name}
                  fill
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                  className="object-cover"
                  unoptimized
                />
                {selectedCard?.id === card.id && (
                  <div className="absolute inset-0 bg-orange-500/20 flex items-center justify-center">
                    <div className="bg-orange-500 rounded-full p-1.5">
                      <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  </div>
                )}
              </div>
              <div className="p-2 bg-white border-t border-zinc-100">
                <p className="text-xs font-medium text-zinc-900 truncate">{card.name}</p>
                <p className="text-[10px] text-zinc-500">{card.id} &middot; {card.rarity}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {hasSearched && !searching && searchResults.length === 0 && searchQuery.length >= 2 && (
        <div className="text-center py-12">
          <p className="text-zinc-400 text-lg">No cards found for &ldquo;{searchQuery}&rdquo;</p>
          <p className="text-zinc-400 text-sm mt-1">Try a different search term</p>
        </div>
      )}

      {!hasSearched && !searching && searchQuery.length < 2 && (
        <div className="text-center py-16">
          <div className="text-5xl mb-4 opacity-30">🃏</div>
          <p className="text-zinc-400">Start typing to find your card</p>
        </div>
      )}
    </div>
  )
}

// ============================================
// Step 2: Condition & Details
// ============================================

function StepDetails({
  selectedCard,
  language,
  setLanguage,
  isGraded,
  setIsGraded,
  gradingCompany,
  setGradingCompany,
  grade,
  setGrade,
}: {
  selectedCard: CardResult
  language: string
  setLanguage: (l: string) => void
  isGraded: boolean
  setIsGraded: (v: boolean) => void
  gradingCompany: GradingCompany | null
  setGradingCompany: (c: GradingCompany) => void
  grade: string
  setGrade: (g: string) => void
}) {
  const [showAllGrades, setShowAllGrades] = useState(false)
  const gradeOptions = gradingCompany
    ? showAllGrades ? GRADING_SCALES[gradingCompany] : GRADING_SCALES[gradingCompany].filter(isGradeEligible)
    : []

  // Fetch highest buyer offer for this card
  const [highestOffer, setHighestOffer] = useState<number | null>(null)

  useEffect(() => {
    if (!selectedCard) return
    fetch(`/api/bids?card_id=${encodeURIComponent(selectedCard.id)}&limit=1`)
      .then(res => res.json())
      .then(data => {
        const bids = data.bids || []
        setHighestOffer(bids.length > 0 ? bids[0].price : null)
      })
      .catch(() => setHighestOffer(null))
  }, [selectedCard])

  return (
    <div>
      <h2 className="text-2xl font-bold text-zinc-900 mb-1">Describe your card</h2>
      <p className="text-zinc-500 mb-6">Help buyers know exactly what they&apos;re getting.</p>

      {/* Card Preview */}
      <div className="flex gap-5 mb-8 p-4 bg-zinc-50 rounded-xl border border-zinc-200">
        <div className="w-24 shrink-0">
          <div className="aspect-[2.5/3.5] relative rounded-lg overflow-hidden bg-zinc-100">
            <Image
              src={selectedCard.imageUrl}
              alt={selectedCard.name}
              fill
              sizes="96px"
              className="object-cover"
              unoptimized
            />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-zinc-900 text-lg">{selectedCard.name}</p>
          <p className="text-sm text-zinc-500">{selectedCard.id} &middot; {selectedCard.rarity}</p>
        </div>
      </div>

      <div className="space-y-5">
        {/* Raw / Graded toggle */}
        <div>
          <label className="block text-sm font-semibold text-zinc-700 mb-2">Card Type</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setIsGraded(false)}
              className={`px-4 py-3 rounded-xl text-sm font-medium transition-all cursor-pointer ${
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
              className={`px-4 py-3 rounded-xl text-sm font-medium transition-all cursor-pointer ${
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
          <div className="px-4 py-3 rounded-xl bg-green-50 border border-green-200">
            <span className="text-sm font-medium text-green-700">Condition: Near Mint (NM)</span>
            <p className="text-xs text-green-600/70 mt-0.5">All raw cards are listed as Near Mint.</p>
          </div>
        )}

        {/* Grading company + grade (graded cards only) */}
        {isGraded && (
          <>
            <div>
              <label className="block text-sm font-semibold text-zinc-700 mb-2">Grading Company</label>
              <div className="grid grid-cols-4 gap-3">
                {(['PSA', 'CGC', 'BGS', 'TAG'] as GradingCompany[]).map((company) => (
                  <button
                    key={company}
                    type="button"
                    onClick={() => { setGradingCompany(company); setGrade('') }}
                    className={`px-4 py-3 rounded-xl text-sm font-medium transition-all cursor-pointer ${
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
                <label className="block text-sm font-semibold text-zinc-700 mb-2">Grade</label>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {gradeOptions.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGrade(g)}
                      className={`px-3 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer ${
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

        {/* Language */}
        <div>
          <label className="block text-sm font-semibold text-zinc-700 mb-2">Language</label>
          <div className="grid grid-cols-2 gap-3">
            {[
              { value: 'EN', label: 'English', flag: '🇺🇸' },
              { value: 'JP', label: 'Japanese', flag: '🇯🇵' },
            ].map((lang) => (
              <button
                key={lang.value}
                type="button"
                onClick={() => setLanguage(lang.value)}
                className={`px-4 py-3 rounded-xl text-sm font-medium transition-all cursor-pointer flex items-center justify-center gap-2 ${
                  language === lang.value
                    ? 'bg-orange-500 text-white ring-2 ring-orange-500 ring-offset-2'
                    : 'bg-zinc-100 text-zinc-700 border border-zinc-200 hover:border-orange-300'
                }`}
              >
                <span>{lang.flag}</span>
                {lang.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================
// Step: Photos (raw cards only)
// ============================================

function StepPhotos({
  photos,
  uploading,
  onUpload,
  onRemove,
}: {
  photos: PhotoSlotMap
  uploading: Record<string, boolean>
  onUpload: (slot: PhotoSlotKey, file: File) => void
  onRemove: (slot: PhotoSlotKey) => void
}) {
  function SlotButton({ slot }: { slot: typeof PHOTO_SLOTS[number] }) {
    const url = photos[slot.key]
    const isUploading = uploading[slot.key]
    const isFull = slot.key === 'front' || slot.key === 'back'

    return (
      <label
        className={`relative rounded-xl border-2 border-dashed transition-all cursor-pointer overflow-hidden flex items-center justify-center ${
          url
            ? 'border-green-300 bg-green-50'
            : isUploading
              ? 'border-orange-300 bg-orange-50'
              : 'border-zinc-200 bg-zinc-50 hover:border-orange-300 hover:bg-orange-50/50'
        } ${isFull ? 'aspect-[2.5/3.5]' : 'aspect-square'}`}
      >
        {url ? (
          <>
            <Image src={url} alt={slot.label} fill className="object-cover" sizes="200px" unoptimized />
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); onRemove(slot.key) }}
              className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/60 hover:bg-black/80 rounded-full flex items-center justify-center text-white transition-colors z-10"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </>
        ) : isUploading ? (
          <div className="text-center">
            <svg className="animate-spin h-6 w-6 text-orange-500 mx-auto mb-1" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-xs text-orange-500">Uploading...</p>
          </div>
        ) : (
          <div className="text-center p-2">
            <svg className="w-6 h-6 text-zinc-300 mx-auto mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            <p className="text-[11px] text-zinc-400 leading-tight">{slot.label}</p>
          </div>
        )}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onUpload(slot.key, file)
            e.target.value = ''
          }}
        />
      </label>
    )
  }

  const filledCount = Object.values(photos).filter(Boolean).length

  return (
    <div>
      <h2 className="text-2xl font-bold text-zinc-900 mb-1">Upload photos</h2>
      <p className="text-zinc-500 mb-6">
        Buyers want to see the card&apos;s condition. Upload all 10 photos.
        <span className="ml-2 font-medium text-zinc-700">{filledCount}/10</span>
      </p>

      {/* Front Photos */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-zinc-700 mb-3">Front</h3>
        <div className="grid grid-cols-4 gap-3">
          <div className="col-span-2 row-span-2">
            <SlotButton slot={FRONT_SLOTS[0]} />
          </div>
          {FRONT_SLOTS.slice(1).map((slot) => (
            <SlotButton key={slot.key} slot={slot} />
          ))}
        </div>
      </div>

      {/* Back Photos */}
      <div>
        <h3 className="text-sm font-semibold text-zinc-700 mb-3">Back</h3>
        <div className="grid grid-cols-4 gap-3">
          <div className="col-span-2 row-span-2">
            <SlotButton slot={BACK_SLOTS[0]} />
          </div>
          {BACK_SLOTS.slice(1).map((slot) => (
            <SlotButton key={slot.key} slot={slot} />
          ))}
        </div>
      </div>
    </div>
  )
}

// ============================================
// Step: Pricing
// ============================================

function StepPricing({
  selectedCard,
  price,
  setPrice,
  quantity,
  setQuantity,
  marketPrice,
}: {
  selectedCard: CardResult
  price: string
  setPrice: (p: string) => void
  quantity: string
  setQuantity: (q: string) => void
  marketPrice: number | null
}) {
  const priceNum = parseFloat(price) || 0

  return (
    <div>
      <h2 className="text-2xl font-bold text-zinc-900 mb-1">Set your price</h2>
      <p className="text-zinc-500 mb-6">Price competitively to sell faster.</p>

      {/* Card Preview */}
      <div className="flex gap-5 mb-6 p-4 bg-zinc-50 rounded-xl border border-zinc-200">
        <div className="w-16 shrink-0">
          <div className="aspect-[2.5/3.5] relative rounded-lg overflow-hidden bg-zinc-100">
            <Image
              src={selectedCard.imageUrl}
              alt={selectedCard.name}
              fill
              sizes="64px"
              className="object-cover"
              unoptimized
            />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-zinc-900">{selectedCard.name}</p>
          <p className="text-sm text-zinc-500">{selectedCard.id}</p>
        </div>
      </div>

      {/* Market Price Reference */}
      {marketPrice && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-blue-800">Market Price</p>
              <p className="text-xs text-blue-600">TCGPlayer average</p>
            </div>
            <p className="text-2xl font-bold text-blue-900">${marketPrice.toFixed(2)}</p>
          </div>
          <button
            type="button"
            onClick={() => setPrice(marketPrice.toFixed(2))}
            className="mt-3 w-full text-sm font-medium text-blue-700 hover:text-blue-800 bg-blue-100 hover:bg-blue-200 py-2 rounded-lg transition-colors cursor-pointer"
          >
            Match market price
          </button>
        </div>
      )}

      <div className="space-y-5">
        {/* Price */}
        <div>
          <label className="block text-sm font-semibold text-zinc-700 mb-2">Your Price (USD)</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 font-medium text-lg">$</span>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              autoFocus
              className="w-full pl-9 pr-4 py-4 rounded-xl bg-zinc-100 border border-zinc-200 text-zinc-900 text-2xl font-semibold focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>
          {marketPrice && priceNum > 0 && (
            <p className={`text-xs mt-2 ${
              priceNum < marketPrice ? 'text-green-600' : priceNum > marketPrice ? 'text-orange-600' : 'text-zinc-400'
            }`}>
              {priceNum < marketPrice
                ? `$${(marketPrice - priceNum).toFixed(2)} below market — great for a quick sale`
                : priceNum > marketPrice
                  ? `$${(priceNum - marketPrice).toFixed(2)} above market`
                  : 'Matching market price'}
            </p>
          )}
        </div>

        {/* Quantity */}
        <div>
          <label className="block text-sm font-semibold text-zinc-700 mb-2">Quantity</label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setQuantity(String(Math.max(1, parseInt(quantity) - 1)))}
              disabled={parseInt(quantity) <= 1}
              className="w-12 h-12 rounded-xl bg-zinc-100 border border-zinc-200 text-zinc-700 hover:bg-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer flex items-center justify-center text-xl font-medium"
            >
              −
            </button>
            <input
              type="number"
              min="1"
              max="99"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-20 text-center py-3 rounded-xl bg-zinc-100 border border-zinc-200 text-zinc-900 text-xl font-semibold focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
            <button
              type="button"
              onClick={() => setQuantity(String(Math.min(99, parseInt(quantity) + 1)))}
              className="w-12 h-12 rounded-xl bg-zinc-100 border border-zinc-200 text-zinc-700 hover:bg-zinc-200 transition-colors cursor-pointer flex items-center justify-center text-xl font-medium"
            >
              +
            </button>
          </div>
        </div>

        {/* Total estimate */}
        {priceNum > 0 && parseInt(quantity) > 0 && (
          <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200">
            <div className="flex items-center justify-between">
              <p className="text-sm text-zinc-500">Total listing value</p>
              <p className="text-lg font-bold text-zinc-900">
                ${(priceNum * parseInt(quantity)).toFixed(2)}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================
// Step 4: Review & Submit
// ============================================

function StepReview({
  selectedCard,
  language,
  price,
  quantity,
  pending,
  error,
  onSubmit,
  isGraded,
  gradingCompany,
  grade,
  photos,
}: {
  selectedCard: CardResult
  language: string
  price: string
  quantity: string
  pending: boolean
  error: string
  onSubmit: () => void
  isGraded: boolean
  gradingCompany: GradingCompany | null
  grade: string
  photos: PhotoSlotMap
}) {
  const priceNum = parseFloat(price) || 0
  const qtyNum = parseInt(quantity) || 1

  return (
    <div>
      <h2 className="text-2xl font-bold text-zinc-900 mb-1">Review your listing</h2>
      <p className="text-zinc-500 mb-6">Make sure everything looks good before publishing.</p>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm">
          {error}
        </div>
      )}

      <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
        {/* Card header */}
        <div className="flex gap-5 p-5 border-b border-zinc-100">
          <div className="w-28 shrink-0">
            <div className="aspect-[2.5/3.5] relative rounded-xl overflow-hidden bg-zinc-100 shadow-lg">
              <Image
                src={selectedCard.imageUrl}
                alt={selectedCard.name}
                fill
                sizes="112px"
                className="object-cover"
                unoptimized
              />
            </div>
          </div>
          <div className="flex-1 min-w-0 py-1">
            <p className="font-bold text-zinc-900 text-xl">{selectedCard.name}</p>
            <p className="text-sm text-zinc-500 mt-0.5">{selectedCard.id} &middot; {selectedCard.rarity}</p>
            <div className="flex items-baseline gap-1 mt-3">
              <span className="text-3xl font-bold text-zinc-900">${priceNum.toFixed(2)}</span>
              {qtyNum > 1 && (
                <span className="text-sm text-zinc-500">x {qtyNum}</span>
              )}
            </div>
          </div>
        </div>

        {/* Details rows */}
        <div className="divide-y divide-zinc-100">
          <div className="flex items-center justify-between px-5 py-3.5">
            <span className="text-sm text-zinc-500">Condition</span>
            <span className="text-sm font-medium text-zinc-900">
              {isGraded && gradingCompany ? `${gradingCompany} ${grade}` : 'Near Mint (NM)'}
            </span>
          </div>
          <div className="flex items-center justify-between px-5 py-3.5">
            <span className="text-sm text-zinc-500">Language</span>
            <span className="text-sm font-medium text-zinc-900">
              {language === 'EN' ? '🇺🇸 English' : '🇯🇵 Japanese'}
            </span>
          </div>
          <div className="flex items-center justify-between px-5 py-3.5">
            <span className="text-sm text-zinc-500">Quantity</span>
            <span className="text-sm font-medium text-zinc-900">{qtyNum}</span>
          </div>
          {qtyNum > 1 && (
            <div className="flex items-center justify-between px-5 py-3.5">
              <span className="text-sm text-zinc-500">Total value</span>
              <span className="text-sm font-bold text-zinc-900">${(priceNum * qtyNum).toFixed(2)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Photos preview (raw only) */}
      {!isGraded && Object.values(photos).some(Boolean) && (
        <div className="mt-4 p-4 bg-zinc-50 rounded-xl border border-zinc-200">
          <p className="text-sm font-medium text-zinc-700 mb-3">Photos ({Object.values(photos).filter(Boolean).length}/10)</p>
          <div className="grid grid-cols-5 gap-2">
            {PHOTO_SLOTS.map(slot => {
              const url = photos[slot.key]
              return url ? (
                <div key={slot.key} className="aspect-square relative rounded-lg overflow-hidden bg-zinc-100">
                  <Image src={url} alt={slot.label} fill className="object-cover" sizes="80px" unoptimized />
                </div>
              ) : (
                <div key={slot.key} className="aspect-square rounded-lg bg-zinc-200/50" />
              )
            })}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={pending}
        className="w-full mt-6 px-4 py-4 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 disabled:cursor-not-allowed text-white font-semibold text-lg transition-colors cursor-pointer"
      >
        {pending ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Publishing...
          </span>
        ) : (
          'Publish Listing'
        )}
      </button>
    </div>
  )
}

// ============================================
// Success Screen with Confetti
// ============================================

function SuccessScreen({ cardName, onViewDashboard, onListAnother }: {
  cardName: string
  onViewDashboard: () => void
  onListAnother: () => void
}) {
  useEffect(() => {
    // Fire confetti
    const duration = 2000
    const end = Date.now() + duration

    const frame = () => {
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.7 },
        colors: ['#f97316', '#fb923c', '#fdba74', '#fed7aa'],
      })
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.7 },
        colors: ['#f97316', '#fb923c', '#fdba74', '#fed7aa'],
      })

      if (Date.now() < end) {
        requestAnimationFrame(frame)
      }
    }
    frame()
  }, [])

  return (
    <div className="text-center py-12">
      <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
        <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 className="text-3xl font-bold text-zinc-900 mb-2">Listed!</h2>
      <p className="text-zinc-500 text-lg mb-8">
        <span className="font-medium text-zinc-700">{cardName}</span> is now live on the marketplace.
      </p>
      <div className="flex gap-3 max-w-sm mx-auto">
        <button
          onClick={onListAnother}
          className="flex-1 px-4 py-3 rounded-xl bg-zinc-100 border border-zinc-200 text-zinc-700 font-medium hover:bg-zinc-200 transition-colors cursor-pointer"
        >
          List Another
        </button>
        <button
          onClick={onViewDashboard}
          className="flex-1 px-4 py-3 rounded-xl bg-orange-500 text-white font-medium hover:bg-orange-600 transition-colors cursor-pointer"
        >
          View Dashboard
        </button>
      </div>
    </div>
  )
}

// ============================================
// Main Sell Page
// ============================================

export default function SellPage() {
  return (
    <Suspense>
      <SellPageContent />
    </Suspense>
  )
}

function SellPageContent() {
  const [step, setStep] = useState(1)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [success, setSuccess] = useState(false)

  // Form state
  const [selectedCard, setSelectedCard] = useState<CardResult | null>(null)
  const [isGraded, setIsGraded] = useState(false)
  const [gradingCompany, setGradingCompany] = useState<GradingCompany | null>(null)
  const [grade, setGrade] = useState('')
  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [language, setLanguage] = useState('EN')
  const [marketPrice, setMarketPrice] = useState<number | null>(null)

  // Photo state (raw cards only)
  const emptyPhotos = Object.fromEntries(PHOTO_SLOTS.map(s => [s.key, null])) as PhotoSlotMap
  const [photos, setPhotos] = useState<PhotoSlotMap>(emptyPhotos)
  const [photoUploading, setPhotoUploading] = useState<Record<string, boolean>>({})

  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  // Dynamic steps: raw cards have a Photos step, graded cards skip it
  const pricingStep = isGraded ? 3 : 4
  const reviewStep = isGraded ? 4 : 5
  const totalSteps = isGraded ? 4 : 5

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

  // Pre-fill from query params (sell-into-bid flow)
  useEffect(() => {
    const cardParam = searchParams.get('card')
    const priceParam = searchParams.get('price')

    if (priceParam) setPrice(priceParam)
    if (cardParam) {
      fetch(`/api/cards?id=${encodeURIComponent(cardParam)}`)
        .then(res => res.json())
        .then(data => {
          const card = data.card
          if (card) {
            const result: CardResult = {
              id: card.id,
              name: card.name,
              setId: card.setId,
              rarity: card.rarity,
              imageUrl: card.imageUrl,
              price: card.price,
            }
            setSelectedCard(result)
            if (card.price?.marketPrice) {
              setMarketPrice(card.price.marketPrice)
            }
            // Go to details — user needs to confirm condition & upload photos
            setStep(2)
          }
        })
        .catch(() => {})
    }
  }, [searchParams])

  // Fetch market price when card is selected
  const fetchMarketPrice = useCallback((cardId: string) => {
    fetch(`/api/cards?id=${encodeURIComponent(cardId)}`)
      .then(res => res.json())
      .then(data => {
        if (data.card?.price?.marketPrice) {
          setMarketPrice(data.card.price.marketPrice)
        }
      })
      .catch(() => {})
  }, [])

  function handleSelectCard(card: CardResult) {
    setSelectedCard(card)
    if (card.price?.marketPrice) {
      setMarketPrice(card.price.marketPrice)
    } else {
      fetchMarketPrice(card.id)
    }
    setStep(2)
  }

  function canProceed(): boolean {
    if (step === 1) return !!selectedCard
    if (step === 2) {
      if (isGraded) return !!gradingCompany && !!grade && !!language
      return !!language
    }
    // Photos step (raw only, step 3)
    if (!isGraded && step === 3) {
      const allFilled = PHOTO_SLOTS.every(s => photos[s.key])
      const anyUploading = Object.values(photoUploading).some(Boolean)
      return allFilled && !anyUploading
    }
    if (step === pricingStep) return !!price && parseFloat(price) > 0 && parseInt(quantity) > 0
    if (step === reviewStep) return true
    return false
  }

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

  async function handleSubmit() {
    if (!selectedCard || !price) return
    setPending(true)
    setError('')

    const conditionLabel = isGraded && gradingCompany
      ? `${gradingCompany} ${grade}`
      : 'NM'
    const title = `${selectedCard.name} (${selectedCard.id}) - ${conditionLabel}`

    try {
      const res = await fetch('/api/listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          card_id: selectedCard.id,
          title,
          condition: 'near_mint',
          price: parseFloat(price),
          quantity: parseInt(quantity),
          language,
          grading_company: isGraded ? gradingCompany : null,
          grade: isGraded ? grade : null,
          photo_urls: isGraded ? [] : PHOTO_SLOTS.map(s => photos[s.key]).filter(Boolean),
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to create listing')
        setPending(false)
      } else {
        setPending(false)
        setSuccess(true)
      }
    } catch {
      setError('Something went wrong. Please try again.')
      setPending(false)
    }
  }

  function handleListAnother() {
    setStep(1)
    setSelectedCard(null)
    setIsGraded(false)
    setGradingCompany(null)
    setGrade('')
    setPrice('')
    setQuantity('1')
    setLanguage('EN')
    setMarketPrice(null)
    setPhotos(emptyPhotos)
    setPhotoUploading({})
    setError('')
    setSuccess(false)
  }

  // Success state
  if (success && selectedCard) {
    return (
      <div className="max-w-5xl mx-auto">
        <SuccessScreen
          cardName={selectedCard.name}
          onViewDashboard={() => router.push('/dashboard')}
          onListAnother={handleListAnother}
        />
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto pb-16">
      <div className="bg-white border border-zinc-200 rounded-2xl p-6 sm:p-8">
        {/* Step Content */}
        {step === 1 && (
          <StepSelectCard
            selectedCard={selectedCard}
            onSelect={handleSelectCard}
          />
        )}

        {step === 2 && selectedCard && (
          <StepDetails
            selectedCard={selectedCard}
            language={language}
            setLanguage={setLanguage}
            isGraded={isGraded}
            setIsGraded={setIsGraded}
            gradingCompany={gradingCompany}
            setGradingCompany={setGradingCompany}
            grade={grade}
            setGrade={setGrade}
          />
        )}

        {!isGraded && step === 3 && selectedCard && (
          <StepPhotos
            photos={photos}
            uploading={photoUploading}
            onUpload={handlePhotoUpload}
            onRemove={handlePhotoRemove}
          />
        )}

        {step === pricingStep && selectedCard && (
          <StepPricing
            selectedCard={selectedCard}
            price={price}
            setPrice={setPrice}
            quantity={quantity}
            setQuantity={setQuantity}
            marketPrice={marketPrice}
          />
        )}

        {step === reviewStep && selectedCard && (
          <StepReview
            selectedCard={selectedCard}
            language={language}
            price={price}
            quantity={quantity}
            pending={pending}
            error={error}
            onSubmit={handleSubmit}
            isGraded={isGraded}
            gradingCompany={gradingCompany}
            grade={grade}
            photos={photos}
          />
        )}

        {/* Navigation */}
        {step < reviewStep && (
          <div className="flex items-center justify-between mt-8 pt-6 border-t border-zinc-100">
            {step > 1 ? (
              <button
                type="button"
                onClick={() => setStep(step - 1)}
                className="flex items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-700 transition-colors cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>
            ) : (
              <div />
            )}
            {/* Step 1 auto-advances on card click, so only show Next for steps 2-3 */}
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep(step + 1)}
                disabled={!canProceed()}
                className="flex items-center gap-1.5 px-6 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-200 disabled:text-zinc-400 disabled:cursor-not-allowed text-white font-medium transition-colors cursor-pointer"
              >
                Next
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}
          </div>
        )}

        {step === reviewStep && (
          <div className="mt-4 pt-4 border-t border-zinc-100">
            <button
              type="button"
              onClick={() => setStep(reviewStep - 1)}
              className="flex items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-700 transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Back to edit
            </button>
          </div>
        )}
      </div>

      <StepIndicator current={step} total={totalSteps} />
    </div>
  )
}
