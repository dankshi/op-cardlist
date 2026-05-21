'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { GRADING_SCALES, type Bid, type GradingCompany } from '@/types/database'

interface BidAskSpreadProps {
  cardId: string
}

// Match the eligibility rule used in /sell — offers can only target slab
// grades 8+ (PSA 10 / BGS Black Label 10 / CGC Pristine 10 etc.). Lower
// grades aren't sellable on Nomi so an offer for them is meaningless.
function isGradeEligible(grade: string): boolean {
  if (grade === 'Black Label 10' || grade === 'Pristine 10') return true
  const n = parseFloat(grade)
  return !isNaN(n) && n >= 8
}

type OfferType = 'raw' | 'graded'

/** Compact label for a bid's variant: "Raw" or "PSA 10". Used as the
 *  section header in the grouped offer display and on the "Sell" button
 *  hover text so the seller knows exactly which variant they're
 *  fulfilling. */
function variantLabel(bid: Pick<Bid, 'grading_company' | 'grade'>): string {
  if (!bid.grading_company || !bid.grade) return 'Raw'
  return `${bid.grading_company} ${bid.grade}`
}

/** Stable key for grouping bids by variant. NULL/NULL collapses to 'raw'
 *  so we don't get a hundred different empty-string buckets. */
function variantKey(bid: Pick<Bid, 'grading_company' | 'grade'>): string {
  return bid.grading_company && bid.grade ? `${bid.grading_company}::${bid.grade}` : 'raw'
}

export function BidAskSpread({ cardId }: BidAskSpreadProps) {
  const router = useRouter()
  const [bids, setBids] = useState<Bid[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [bidPrice, setBidPrice] = useState('')
  const [offerType, setOfferType] = useState<OfferType>('raw')
  const [gradingCompany, setGradingCompany] = useState<GradingCompany>('PSA')
  const [grade, setGrade] = useState<string>('')
  const [showAllGrades, setShowAllGrades] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [isSeller, setIsSeller] = useState(false)

  useEffect(() => {
    async function load() {
      const supabase = createClient()

      const { data: { user } } = await supabase.auth.getUser()
      setCurrentUserId(user?.id || null)

      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_seller, seller_approved')
          .eq('id', user.id)
          .single()
        setIsSeller(!!profile?.is_seller && !!profile?.seller_approved)
      }

      const bidRes = await fetch(`/api/bids?card_id=${encodeURIComponent(cardId)}&limit=50`)
      const bidData = await bidRes.json()
      setBids(bidData.bids || [])

      setLoading(false)
    }
    load()
  }, [cardId])

  // Grade options for the currently-selected grader, filtered to the
  // sellable set unless the user clicks "show lower grades". Mirrors the
  // sell-flow UX so the two surfaces stay consistent.
  const gradeOptions = useMemo(() => {
    const all = GRADING_SCALES[gradingCompany] ?? []
    return showAllGrades ? all : all.filter(isGradeEligible)
  }, [gradingCompany, showAllGrades])

  // Group bids by variant for display. Raw first (since it's most common),
  // then graded variants ordered by best top-bid descending.
  const groupedBids = useMemo(() => {
    const groups = new Map<string, { label: string; bids: Bid[] }>()
    for (const b of bids) {
      const key = variantKey(b)
      const label = variantLabel(b)
      const existing = groups.get(key)
      if (existing) existing.bids.push(b)
      else groups.set(key, { label, bids: [b] })
    }
    const entries = Array.from(groups.entries())
    // Raw on top, then graded by top-bid desc.
    entries.sort((a, b) => {
      if (a[0] === 'raw') return -1
      if (b[0] === 'raw') return 1
      return Number(b[1].bids[0]?.price ?? 0) - Number(a[1].bids[0]?.price ?? 0)
    })
    return entries.map(([key, { label, bids }]) => ({
      key,
      label,
      bids: bids.sort((a, b) => Number(b.price) - Number(a.price)),
    }))
  }, [bids])

  async function handlePlaceOffer(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (offerType === 'graded' && !grade) {
      setError('Pick a grade for the offer.')
      return
    }
    setSubmitting(true)
    const res = await fetch('/api/bids', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        card_id: cardId,
        price: parseFloat(bidPrice),
        grading_company: offerType === 'graded' ? gradingCompany : null,
        grade: offerType === 'graded' ? grade : null,
      }),
    })
    if (res.ok) {
      const newBid = await res.json()
      setBids(prev => [newBid, ...prev])
      setShowForm(false)
      setBidPrice('')
      setOfferType('raw')
      setGrade('')
    } else {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Failed to place offer.')
    }
    setSubmitting(false)
  }

  async function handleCancelOffer(bidId: string) {
    await fetch(`/api/bids?id=${bidId}`, { method: 'DELETE' })
    setBids(prev => prev.filter(b => b.id !== bidId))
  }

  function handleSellIntoOffer(bid: Bid) {
    if (!currentUserId) {
      router.push('/auth/sign-in')
      return
    }
    if (!isSeller) {
      router.push('/seller/apply')
      return
    }
    // Pass through grading info so the sell flow lands on the pricing
    // step with the variant pre-selected — seller doesn't have to
    // re-pick raw/graded + company + grade.
    const qs = new URLSearchParams({ card: cardId, price: Number(bid.price).toFixed(2) })
    if (bid.grading_company && bid.grade) {
      qs.set('grading_company', bid.grading_company)
      qs.set('grade', bid.grade)
    }
    router.push(`/sell?${qs.toString()}`)
  }

  if (loading) {
    return <div className="h-8 rounded bg-zinc-50 animate-pulse" />
  }

  return (
    <div>
      {/* Header row */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-zinc-700 uppercase tracking-wide">Offers</span>
          {bids.length > 0 && (
            <span className="text-[11px] text-zinc-400">({bids.length})</span>
          )}
        </div>
        {!showForm && (
          <button
            onClick={() => {
              if (!currentUserId) { router.push('/auth/sign-in'); return }
              setShowForm(true)
            }}
            className="text-xs px-2.5 py-1 rounded-md bg-orange-50 text-orange-600 hover:bg-orange-100 font-medium transition-colors cursor-pointer"
          >
            + Make an Offer
          </button>
        )}
      </div>

      {/* Offer form */}
      {showForm && (
        <form onSubmit={handlePlaceOffer} className="mb-3 p-3 bg-zinc-50 border border-zinc-200 rounded-lg space-y-3">
          {/* Variant — raw vs graded slab. A graded offer specifies
              (company, grade); raw offers default to NM. */}
          <div className="grid grid-cols-2 gap-2">
            {(['raw', 'graded'] as OfferType[]).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setOfferType(t)}
                className={`py-1.5 rounded-md text-xs font-medium transition-colors capitalize cursor-pointer ${
                  offerType === t
                    ? 'bg-zinc-900 text-white'
                    : 'bg-white border border-zinc-200 text-zinc-700 hover:border-zinc-300'
                }`}
              >
                {t === 'raw' ? 'Raw NM' : 'Graded slab'}
              </button>
            ))}
          </div>

          {offerType === 'graded' && (
            <>
              <div className="grid grid-cols-4 gap-1.5">
                {(['PSA', 'CGC', 'BGS', 'TAG'] as GradingCompany[]).map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => { setGradingCompany(c); setGrade('') }}
                    className={`py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                      gradingCompany === c
                        ? 'bg-orange-500 text-white'
                        : 'bg-white border border-zinc-200 text-zinc-700 hover:border-orange-300'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>

              <div>
                <div className="grid grid-cols-3 gap-1.5">
                  {gradeOptions.map(g => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGrade(g)}
                      className={`py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                        grade === g
                          ? 'bg-orange-500 text-white'
                          : 'bg-white border border-zinc-200 text-zinc-700 hover:border-orange-300'
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
                    className="mt-1.5 text-[11px] text-zinc-400 hover:text-zinc-600 transition-colors cursor-pointer"
                  >
                    Show lower grades ↓
                  </button>
                )}
              </div>
            </>
          )}

          {/* Price */}
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 text-sm">$</span>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={bidPrice}
              onChange={e => setBidPrice(e.target.value)}
              required
              placeholder="0.00"
              className="w-full pl-6 pr-2 py-2 rounded-lg bg-white border border-zinc-200 text-zinc-900 text-sm focus:border-orange-300 focus:outline-none"
            />
          </div>

          {error && (
            <p className="text-xs text-red-600">{error}</p>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting || (offerType === 'graded' && !grade)}
              className="flex-1 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {submitting ? 'Submitting...' : `Place ${offerType === 'graded' && grade ? `${gradingCompany} ${grade}` : 'Raw NM'} Offer`}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setError(null) }}
              className="px-4 py-2 rounded-lg text-zinc-500 hover:text-zinc-700 text-sm border border-zinc-200 hover:border-zinc-300 transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Grouped offers — one section per variant (Raw, PSA 10, …) so
          a seller browsing this card sees offers relevant to whatever
          condition they own. */}
      {groupedBids.length > 0 ? (
        <div className="space-y-3">
          {groupedBids.map(group => (
            <div key={group.key}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500">
                  {group.label}
                </span>
                <span className="text-[11px] text-zinc-400">{group.bids.length} offer{group.bids.length === 1 ? '' : 's'}</span>
              </div>
              <div className="space-y-1.5">
                {group.bids.slice(0, 3).map(bid => (
                  <div key={bid.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-green-50/50 border border-green-100">
                    <span className="text-sm font-semibold text-green-600">
                      ${Number(bid.price).toFixed(2)}
                    </span>
                    <div className="flex items-center gap-2">
                      {bid.user_id !== currentUserId && isSeller && (
                        <button
                          onClick={() => handleSellIntoOffer(bid)}
                          className="text-xs px-2.5 py-1 rounded-md bg-green-600 text-white font-medium hover:bg-green-700 transition-colors cursor-pointer"
                          title={`Sell a ${group.label} into this offer`}
                        >
                          Sell
                        </button>
                      )}
                      {bid.user_id === currentUserId && (
                        <button
                          onClick={() => handleCancelOffer(bid.id)}
                          className="text-xs text-red-400 hover:text-red-600 cursor-pointer"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {group.bids.length > 3 && (
                  <p className="text-[11px] text-zinc-400 text-center pt-0.5">
                    +{group.bids.length - 3} more {group.label} offer{group.bids.length - 3 !== 1 ? 's' : ''}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        !showForm && <p className="text-xs text-zinc-400 py-2">No offers yet. Be the first!</p>
      )}
    </div>
  )
}
