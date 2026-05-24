import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/** PATCH /api/bids/[bidId]
 *
 *  Update the price of one of the caller's own active offers. Used by the
 *  inline quick-action buttons in the Offers tab (+$1, +$5, Match top).
 *
 *  Constraints:
 *   - Caller must own the bid (RLS already enforces this, belt + braces).
 *   - Bid must be `active` (you can't edit a filled or cancelled bid).
 *   - New price must be > 0.
 *   - Bids that carry a Stripe pre-auth (`stripe_payment_intent_id`)
 *     can NOT be edited in place — the original auth reserved a specific
 *     amount on the buyer's card, and Stripe only lets us decrease the
 *     amount of a manual-capture PI. To raise the offer they need to
 *     cancel + place a fresh one (which kicks off a new auth flow).
 *     Legacy seeded bids without a PI can be edited freely.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ bidId: string }> },
) {
  const { bidId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const newPrice = Number(body?.price)
  if (!Number.isFinite(newPrice) || newPrice <= 0) {
    return NextResponse.json({ error: 'price must be a positive number' }, { status: 400 })
  }

  const { data: bid, error: bidErr } = await supabase
    .from('bids')
    .select('id, user_id, status, stripe_payment_intent_id, card_id, grading_company, grade')
    .eq('id', bidId)
    .single()
  if (bidErr || !bid) return NextResponse.json({ error: 'Bid not found' }, { status: 404 })
  if (bid.user_id !== user.id) return NextResponse.json({ error: 'Not your bid' }, { status: 403 })
  if (bid.status !== 'active') return NextResponse.json({ error: 'Bid is not active' }, { status: 400 })
  if (bid.stripe_payment_intent_id) {
    // See header comment — pre-auth bids need cancel + replace.
    return NextResponse.json(
      { error: 'Pre-authorized offers can’t be edited in place. Cancel this offer and place a new one to change the price.' },
      { status: 400 },
    )
  }

  // Guardrail: don't let the seller price an offer at or above the
  // lowest listing for the same variant — at that price they should
  // just buy the listing. Mirrors the display filter on the Offers tab.
  let askQuery = supabase
    .from('listings')
    .select('price')
    .eq('card_id', bid.card_id)
    .eq('status', 'active')
    .order('price', { ascending: true })
    .limit(1)
  askQuery = bid.grading_company
    ? askQuery.eq('grading_company', bid.grading_company).eq('grade', bid.grade)
    : askQuery.is('grading_company', null).is('grade', null)
  const { data: lowestAsk } = await askQuery
  const askPrice = lowestAsk?.[0]?.price != null ? Number(lowestAsk[0].price) : null
  if (askPrice != null && newPrice >= askPrice) {
    return NextResponse.json(
      { error: `Offer must be below the lowest listing ($${askPrice.toFixed(2)}). Buy the listing if you'd pay that price.` },
      { status: 400 },
    )
  }

  const { error: updateErr } = await supabase
    .from('bids')
    .update({ price: newPrice, updated_at: new Date().toISOString() })
    .eq('id', bidId)
  if (updateErr) {
    console.error('[PATCH /api/bids/[bidId]] update failed', updateErr)
    return NextResponse.json({ error: 'Failed to update offer' }, { status: 500 })
  }

  return NextResponse.json({ success: true, price: newPrice })
}
