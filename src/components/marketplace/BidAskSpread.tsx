'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { createClient } from '@/lib/supabase/client'
import { getStripeClient } from '@/lib/stripe-client'
import { GRADING_SCALES, type Bid, type GradingCompany } from '@/types/database'

interface BidAskSpreadProps {
  cardId: string
  /** When true, the offer-placement form opens on mount instead of the
   *  buyer needing to click "Place Offer" first. Used by the modal entry
   *  point from the buy panel — they clicked Offer, they want the form. */
  initialFormOpen?: boolean
  /** Pre-fill the form's variant picker so the user lands on the same
   *  variant they had selected in the card-page chip row. They can still
   *  change it inside the form. */
  initialOfferType?: 'raw' | 'graded'
  initialGradingCompany?: GradingCompany
  initialGrade?: string
  /** Hide the "existing bids stack" rendering — used in the modal where
   *  the focus is just the offer form. Default false (show the stack on
   *  the standalone /market view). */
  hideExistingBids?: boolean
  /** When set, the rendered bids list is filtered to this exact variant.
   *  Lets the market-data drawer's Offers tab honor the chip selection
   *  on the buy panel above. `{ company: null, grade: null }` = ungraded. */
  variantFilter?: { company: string | null; grade: string | null }
  /** Fired after the user successfully places an offer. Lets the parent
   *  modal switch to a success state + push the new bid into shared
   *  state so the market drawer reflects it without a page reload. */
  onPlaced?: (bid: Bid) => void
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

/** Compact label for a bid's variant: "Ungraded NM" or "PSA 10". */
function variantLabel(bid: Pick<Bid, 'grading_company' | 'grade'>): string {
  if (!bid.grading_company || !bid.grade) return 'Ungraded NM'
  return `${bid.grading_company} ${bid.grade}`
}

/** Stable key for grouping bids by variant. NULL/NULL collapses to 'raw'. */
function variantKey(bid: Pick<Bid, 'grading_company' | 'grade'>): string {
  return bid.grading_company && bid.grade ? `${bid.grading_company}::${bid.grade}` : 'raw'
}

const stripePromise = getStripeClient()

export function BidAskSpread({
  cardId,
  initialFormOpen = false,
  initialOfferType,
  initialGradingCompany,
  initialGrade,
  hideExistingBids = false,
  variantFilter,
  onPlaced,
}: BidAskSpreadProps) {
  const router = useRouter()
  const [bids, setBids] = useState<Bid[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(initialFormOpen)
  const [bidPrice, setBidPrice] = useState('')
  const [offerType, setOfferType] = useState<OfferType>(initialOfferType ?? 'raw')
  const [gradingCompany, setGradingCompany] = useState<GradingCompany>(initialGradingCompany ?? 'PSA')
  const [grade, setGrade] = useState<string>(initialGrade ?? '')
  const [showAllGrades, setShowAllGrades] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [isSeller, setIsSeller] = useState(false)
  // After a successful /api/bids/intent the client_secret + intent id
  // come back here. Presence of `pendingIntent` flips the form from
  // "pick variant + price" → "enter card via Stripe Elements".
  const [pendingIntent, setPendingIntent] = useState<{ clientSecret: string; paymentIntentId: string } | null>(null)
  // Tracks which bid the seller is in the middle of accepting so the
  // tile shows a spinner state and can't be double-clicked.
  const [acceptingId, setAcceptingId] = useState<string | null>(null)
  // Lowest active listing price per variant key (e.g. "raw" → 12.50,
  // "PSA::10" → 215.00). Used to nudge buyers away from offering MORE
  // than they could just buy the card at — almost always means they
  // picked the wrong variant (e.g. selected Raw when they meant PSA 10).
  const [lowestAskByVariant, setLowestAskByVariant] = useState<Record<string, number>>({})
  const supabase = useMemo(() => createClient(), [])
  const didLoad = useRef(false)

  useEffect(() => {
    if (didLoad.current) return
    didLoad.current = true
    async function load() {
      // Bids endpoint doesn't need auth context — fire it in parallel with
      // the user lookup so the slower of the two is the only thing on the
      // critical path.
      const bidsPromise = fetch(`/api/bids?card_id=${encodeURIComponent(cardId)}&limit=50`)
        .then(r => r.json())
        .catch(() => ({ bids: [] }))

      // Lowest active listing price per variant — informs the "you can
      // buy it now for $X" nudge in the offer form. Cheap query; pulls
      // every active listing for the card and reduces in JS so we don't
      // need a per-variant SQL function.
      const listingsPromise = supabase
        .from('listings')
        .select('price, grading_company, grade')
        .eq('card_id', cardId)
        .eq('status', 'active')
        .gt('quantity_available', 0)
        .then(({ data }) => {
          const byVariant: Record<string, number> = {}
          for (const l of data ?? []) {
            const key = l.grading_company && l.grade ? `${l.grading_company}::${l.grade}` : 'raw'
            const price = Number(l.price)
            if (!Number.isFinite(price) || price <= 0) continue
            if (byVariant[key] == null || price < byVariant[key]) byVariant[key] = price
          }
          return byVariant
        })

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
      const [bidData, listingMap] = await Promise.all([bidsPromise, listingsPromise])
      setBids(bidData.bids || [])
      setLowestAskByVariant(listingMap)
      setLoading(false)
    }
    load()
  }, [cardId, supabase])

  const gradeOptions = useMemo(() => {
    const all = GRADING_SCALES[gradingCompany] ?? []
    return showAllGrades ? all : all.filter(isGradeEligible)
  }, [gradingCompany, showAllGrades])

  // Lowest active listing for whatever variant the form is currently set
  // to. Used both to nudge the buyer inline ("you can buy now for $X")
  // and to gate the submit with a confirm when their offer >= the ask.
  const currentVariantKey = offerType === 'graded' && gradingCompany && grade
    ? `${gradingCompany}::${grade}`
    : 'raw'
  const currentLowestAsk = lowestAskByVariant[currentVariantKey] ?? null
  const offerPriceNum = parseFloat(bidPrice)
  const offerAtOrAboveAsk = Number.isFinite(offerPriceNum) && offerPriceNum > 0
    && currentLowestAsk != null
    && offerPriceNum >= currentLowestAsk

  const groupedBids = useMemo(() => {
    const groups = new Map<string, { label: string; bids: Bid[] }>()
    // Apply the external variant filter (from the buy-panel chip) before
    // grouping so the rendered offers tab matches what the user sees in
    // the chip row above.
    const visibleBids = variantFilter
      ? bids.filter(b =>
          (b.grading_company ?? null) === (variantFilter.company ?? null)
          && (b.grade ?? null) === (variantFilter.grade ?? null)
        )
      : bids
    for (const b of visibleBids) {
      const key = variantKey(b)
      const label = variantLabel(b)
      const existing = groups.get(key)
      if (existing) existing.bids.push(b)
      else groups.set(key, { label, bids: [b] })
    }
    const entries = Array.from(groups.entries())
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bids, variantFilter?.company, variantFilter?.grade])

  /** Step 1: variant + price → create the PaymentIntent (capture_method=manual). */
  async function handleStartOffer(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (offerType === 'graded' && !grade) {
      setError('Pick a grade for the offer.')
      return
    }
    const priceNum = parseFloat(bidPrice)
    if (!priceNum || priceNum <= 0) {
      setError('Enter a valid offer price.')
      return
    }
    // If they're offering at-or-above the lowest matching listing, they
    // probably picked the wrong variant (Ungraded NM when they meant PSA 10
    // is the canonical mistake). Confirm before locking up a card hold.
    if (offerAtOrAboveAsk && currentLowestAsk != null) {
      const variantName = offerType === 'graded' ? `${gradingCompany} ${grade}` : 'Ungraded NM'
      const ok = window.confirm(
        `Heads up: there's already a ${variantName} listing for $${currentLowestAsk.toFixed(2)} ` +
        `— you can buy it right now instead of placing a $${priceNum.toFixed(2)} offer.\n\n` +
        `Most common reason buyers see this: the wrong variant was picked (Raw vs graded). ` +
        `Double-check the variant above is the one you meant.\n\n` +
        `Click OK to place the offer anyway, or Cancel to go back.`,
      )
      if (!ok) return
    }
    setSubmitting(true)
    const res = await fetch('/api/bids/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        card_id: cardId,
        price: priceNum,
        grading_company: offerType === 'graded' ? gradingCompany : null,
        grade: offerType === 'graded' ? grade : null,
      }),
    })
    setSubmitting(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Failed to start offer.')
      return
    }
    const data = await res.json()
    setPendingIntent({ clientSecret: data.clientSecret, paymentIntentId: data.paymentIntentId })
  }

  /** Called by the Elements sub-component after card confirmation lands the
   *  PI in 'requires_capture'. Creates the actual bid row. */
  async function handleFinalizeOffer(paymentIntentId: string) {
    setError(null)
    setSubmitting(true)
    const res = await fetch('/api/bids', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        card_id: cardId,
        price: parseFloat(bidPrice),
        grading_company: offerType === 'graded' ? gradingCompany : null,
        grade: offerType === 'graded' ? grade : null,
        payment_intent_id: paymentIntentId,
      }),
    })
    setSubmitting(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Failed to place offer.')
      return
    }
    const newBid = await res.json()
    setBids(prev => [newBid, ...prev])
    closeForm()
    onPlaced?.(newBid)
  }

  function closeForm() {
    setShowForm(false)
    setBidPrice('')
    setOfferType('raw')
    setGrade('')
    setPendingIntent(null)
    setError(null)
  }

  async function handleCancelOffer(bidId: string) {
    await fetch(`/api/bids?id=${bidId}`, { method: 'DELETE' })
    setBids(prev => prev.filter(b => b.id !== bidId))
  }

  /** Sell-into-offer. New (pre-auth) bids go through the fast-capture
   *  accept endpoint — money moves immediately, order is created server
   *  side, seller lands on the order page. Legacy bids (no PI) fall back
   *  to the old /sell?card= flow where the seller has to publish a
   *  listing and the buyer has to come back to pay separately. */
  async function handleSellIntoOffer(bid: Bid) {
    if (!currentUserId) { router.push('/auth/sign-in'); return }
    if (!isSeller) { router.push('/seller/apply'); return }

    if (bid.stripe_payment_intent_id) {
      const confirmed = window.confirm(
        `You're about to sell your ${variantLabel(bid)} for $${Number(bid.price).toFixed(2)}. ` +
        `The buyer's card will be charged immediately and the order will be created. Proceed?`,
      )
      if (!confirmed) return
      setAcceptingId(bid.id)
      const res = await fetch(`/api/bids/${bid.id}/accept`, { method: 'POST' })
      setAcceptingId(null)
      if (res.ok) {
        const data = await res.json()
        router.push(`/orders/${data.orderId}`)
      } else {
        const body = await res.json().catch(() => ({}))
        alert(body.error ?? 'Failed to accept offer.')
        // Refresh bids so a since-cancelled offer disappears.
        const bidRes = await fetch(`/api/bids?card_id=${encodeURIComponent(cardId)}&limit=50`)
        const bidData = await bidRes.json()
        setBids(bidData.bids || [])
      }
      return
    }

    // Legacy fallback — no PI on the bid, route through the /sell flow.
    const qs = new URLSearchParams({ card: cardId, price: Number(bid.price).toFixed(2) })
    if (bid.grading_company && bid.grade) {
      qs.set('grading_company', bid.grading_company)
      qs.set('grade', bid.grade)
    }
    router.push(`/sell?${qs.toString()}`)
  }

  // When the offer modal mounts us with initialFormOpen, we want the
  // form visible immediately — the bids+listings+user fetches are useful
  // (for the "you can buy now for $X" nudge) but the form itself can
  // render without them, and the buyer's blocked from submitting useful
  // input behind a skeleton is worse than missing one inline hint.
  if (loading && !initialFormOpen) {
    return <div className="h-8 rounded bg-zinc-50 animate-pulse" />
  }

  return (
    <div>
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

      {/* Two-step offer form. Step 1: variant + price → /api/bids/intent.
          Step 2: Stripe Elements card entry → confirm → /api/bids. */}
      {showForm && !pendingIntent && (
        <form onSubmit={handleStartOffer} className="mb-3 p-3 bg-zinc-50 border border-zinc-200 rounded-lg space-y-3">
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
                {t === 'raw' ? 'Ungraded NM' : 'Graded slab'}
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

          <div>
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
                className={`w-full pl-6 pr-2 py-2 rounded-lg bg-white border text-zinc-900 text-sm focus:outline-none transition-colors ${
                  offerAtOrAboveAsk
                    ? 'border-amber-400 focus:border-amber-500'
                    : 'border-zinc-200 focus:border-orange-300'
                }`}
              />
            </div>
            {/* Lowest-ask reference: tells the buyer they could buy at $X
                instead of bidding. Switches to a stronger amber warning
                when their offer hits or exceeds the ask — common signal
                they picked the wrong variant. */}
            {currentLowestAsk != null && (
              offerAtOrAboveAsk ? (
                <p className="mt-1.5 text-[11px] text-amber-700 leading-snug">
                  ⚠ A {offerType === 'graded' ? `${gradingCompany} ${grade}` : 'Ungraded NM'} listing
                  is already <strong>${currentLowestAsk.toFixed(2)}</strong>. You can{' '}
                  <a href="#listings" className="underline hover:no-underline">buy now</a>{' '}
                  instead — make sure you picked the right variant above.
                </p>
              ) : (
                <p className="mt-1.5 text-[11px] text-zinc-400 leading-snug">
                  Lowest active {offerType === 'graded' ? `${gradingCompany} ${grade}` : 'Ungraded NM'} listing: ${currentLowestAsk.toFixed(2)}
                </p>
              )
            )}
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting || (offerType === 'graded' && !grade)}
              className="flex-1 py-2 rounded-lg bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {submitting ? 'Preparing…' : `Continue to card →`}
            </button>
            <button
              type="button"
              onClick={closeForm}
              className="px-4 py-2 rounded-lg text-zinc-500 hover:text-zinc-700 text-sm border border-zinc-200 hover:border-zinc-300 transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
          <p className="text-[10px] text-zinc-400 leading-snug">
            Next step: enter your card. You won&apos;t be charged unless a seller accepts.
          </p>
        </form>
      )}

      {showForm && pendingIntent && (
        <div className="mb-3 p-3 bg-zinc-50 border border-zinc-200 rounded-lg space-y-3">
          <div className="text-xs text-zinc-600">
            <strong className="text-zinc-900">${parseFloat(bidPrice).toFixed(2)}</strong>{' '}
            offer for <strong className="text-zinc-900">{offerType === 'graded' ? `${gradingCompany} ${grade}` : 'Ungraded NM'}</strong>.
            Your card will be reserved but <strong>not charged</strong> until a seller accepts.
          </div>
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret: pendingIntent.clientSecret,
              appearance: {
                theme: 'stripe',
                variables: {
                  colorPrimary: '#f97316',
                  colorBackground: '#ffffff',
                  colorText: '#18181b',
                  colorDanger: '#ef4444',
                  fontFamily: 'Inter, system-ui, sans-serif',
                  borderRadius: '8px',
                },
              },
            }}
          >
            <OfferCardEntry
              paymentIntentId={pendingIntent.paymentIntentId}
              onConfirmed={() => handleFinalizeOffer(pendingIntent.paymentIntentId)}
              onCancel={closeForm}
              submitting={submitting}
              error={error}
              setError={setError}
            />
          </Elements>
        </div>
      )}

      {hideExistingBids ? null : groupedBids.length > 0 ? (
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
                          disabled={acceptingId === bid.id}
                          className="text-xs px-2.5 py-1 rounded-md bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                          title={`Sell a ${group.label} into this offer`}
                        >
                          {acceptingId === bid.id ? 'Accepting…' : 'Sell'}
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
        !showForm && !hideExistingBids && <p className="text-xs text-zinc-400 py-2">No offers yet. Be the first!</p>
      )}
    </div>
  )
}

/** Stripe Elements sub-component. Has to live inside <Elements> so the
 *  useStripe/useElements hooks resolve. Confirms the PaymentIntent
 *  client-side (lands it in 'requires_capture') and tells the parent to
 *  finalize the bid row. */
function OfferCardEntry({
  paymentIntentId,
  onConfirmed,
  onCancel,
  submitting,
  error,
  setError,
}: {
  paymentIntentId: string
  onConfirmed: () => void
  onCancel: () => void
  submitting: boolean
  error: string | null
  setError: (s: string | null) => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [confirming, setConfirming] = useState(false)

  async function handleConfirm(e: FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setError(null)
    setConfirming(true)
    // redirect: 'if_required' keeps the user in-page when the bank
    // doesn't require 3DS. For 3DS-required cards Stripe will redirect
    // and bring them back to the same URL — Elements re-mounts and
    // reads the (now requires_capture) PI status, then we finalize.
    const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
    })
    setConfirming(false)
    if (stripeError) {
      setError(stripeError.message ?? 'Card confirmation failed.')
      return
    }
    if (paymentIntent && paymentIntent.id === paymentIntentId && paymentIntent.status === 'requires_capture') {
      onConfirmed()
    } else {
      setError(`Unexpected payment intent state: ${paymentIntent?.status ?? 'unknown'}`)
    }
  }

  const busy = confirming || submitting

  return (
    <form onSubmit={handleConfirm} className="space-y-3">
      <PaymentElement />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy || !stripe || !elements}
          className="flex-1 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          {busy ? 'Placing offer…' : 'Place Offer'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="px-4 py-2 rounded-lg text-zinc-500 hover:text-zinc-700 text-sm border border-zinc-200 hover:border-zinc-300 disabled:opacity-50 transition-colors cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
