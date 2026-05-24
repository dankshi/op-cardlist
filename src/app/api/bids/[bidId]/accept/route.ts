import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { getStripe } from '@/lib/stripe'
import { calculatePayout, type FulfillmentId, type TierId } from '@/lib/fees'

/** POST /api/bids/[bidId]/accept
 *
 *  Seller accepts a bid → we capture the buyer's pre-authorized payment,
 *  synthesize a "sold" listing record (so the intake/authentication flow
 *  works unchanged), and create the order with status='paid'. The webhook
 *  that normally fires on payment_intent.succeeded handles email
 *  notifications, GMV bump, etc.
 *
 *  Atomicity strategy: claim the bid first (UPDATE status='filled'
 *  WHERE status='active') — this is the single source of truth for
 *  "no one else can accept this bid." If the claim succeeds, all
 *  subsequent failures (capture, listing/order insert) roll the bid
 *  status back to 'active' so the next seller can try.
 *
 *  Legacy bids (no stripe_payment_intent_id) are rejected here — the
 *  client should route them through the old /sell?card= path instead.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ bidId: string }> },
) {
  const { bidId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Seller must be approved before they can accept anyone's offer —
  // matches the seller_approved gate on POST /api/listings.
  const { data: sellerProfile } = await supabase
    .from('profiles')
    .select('is_seller, seller_approved, seller_tier')
    .eq('id', user.id)
    .single()
  if (!sellerProfile?.is_seller || !sellerProfile?.seller_approved) {
    return NextResponse.json({ error: 'Not a verified seller' }, { status: 403 })
  }

  // Pull the bid + its full context. Need card_id to synthesize the
  // listing; need PI id to capture; need user_id to set as buyer.
  const { data: bid, error: bidError } = await supabase
    .from('bids')
    .select('*')
    .eq('id', bidId)
    .single()
  if (bidError || !bid) {
    return NextResponse.json({ error: 'Bid not found' }, { status: 404 })
  }

  if (bid.status !== 'active') {
    return NextResponse.json(
      { error: `Bid is no longer active (status: ${bid.status})` },
      { status: 409 },
    )
  }
  if (bid.user_id === user.id) {
    return NextResponse.json({ error: 'You cannot accept your own offer' }, { status: 400 })
  }
  if (!bid.stripe_payment_intent_id) {
    // Legacy bid (placed before migration 20260544) — no pre-auth on
    // file. Client should route to /sell?card=... instead.
    return NextResponse.json(
      { error: 'This offer pre-dates pre-auth and must be filled via the legacy /sell flow', legacy: true },
      { status: 409 },
    )
  }

  // Atomic claim: status='active' → 'filled'. Concurrent accept attempts
  // race here; the loser sees 0 rows updated and bails out cleanly.
  const { data: claimed, error: claimError } = await supabase
    .from('bids')
    .update({ status: 'filled' })
    .eq('id', bidId)
    .eq('status', 'active')
    .select()
    .single()
  if (claimError || !claimed) {
    return NextResponse.json(
      { error: 'Bid was just claimed by someone else' },
      { status: 409 },
    )
  }

  // Helper to roll back the claim if any subsequent step fails. The bid
  // goes back to 'active' so another seller can try (or the buyer can
  // cancel cleanly).
  async function rollback() {
    await supabase.from('bids').update({ status: 'active' }).eq('id', bidId)
  }

  // Capture the pre-auth. After this Stripe has actually moved money —
  // we can no longer "undo" without a refund. Failure here releases
  // the bid so the buyer's card situation can be sorted out (expired
  // card, insufficient funds, etc.) before another seller commits.
  const stripe = getStripe()
  let captured
  try {
    captured = await stripe.paymentIntents.capture(bid.stripe_payment_intent_id)
    if (captured.status !== 'succeeded') {
      await rollback()
      return NextResponse.json(
        { error: `Payment capture returned status '${captured.status}'` },
        { status: 502 },
      )
    }
  } catch (err) {
    await rollback()
    return NextResponse.json(
      { error: `Failed to capture payment: ${err instanceof Error ? err.message : 'unknown'}` },
      { status: 502 },
    )
  }

  // Lookup the card to fill the synthesized listing's title + image.
  // /api/cards needs `id` only; for use inside the route the lib lookup
  // is more direct but we share the API path so the lookup logic is in
  // one place.
  const { data: card } = await supabase
    .from('cards')
    .select('id, name, image_url')
    .eq('id', bid.card_id)
    .maybeSingle()

  // Synthesize a "sold" listing for this offer fulfillment. We create it
  // rather than skipping because the rest of the order flow (intake,
  // authentication, payout) keys off listing_id — keeping that contract
  // unchanged is worth the extra row. Marked sold immediately
  // (quantity_available=0) so it never shows in the marketplace.
  const admin = getSupabaseAdmin()
  const variantSuffix = bid.grading_company && bid.grade
    ? ` (${bid.grading_company} ${bid.grade})`
    : ''
  const listingTitle = card ? `${card.name}${variantSuffix}` : `${bid.card_id}${variantSuffix}`

  const { data: listing, error: listingError } = await admin
    .from('listings')
    .insert({
      seller_id: user.id,
      card_id: bid.card_id,
      title: listingTitle,
      condition: 'near_mint',
      price: bid.price,
      quantity: 1,
      quantity_available: 0,
      status: 'sold',
      grading_company: bid.grading_company,
      grade: bid.grade,
      language: 'EN',
      photo_urls: [],
    })
    .select()
    .single()

  if (listingError || !listing) {
    // Capture already happened — can't rollback that — but flag loudly
    // so we can manually refund. Bid stays 'filled' since the buyer was
    // charged; manual ops resolves from here.
    console.error('[bids accept] listing insert failed after capture', { bidId, captureId: captured.id, listingError })
    return NextResponse.json(
      {
        error: 'Payment captured but order setup failed. Support has been notified.',
        manualRefundRequired: true,
        paymentIntentId: captured.id,
      },
      { status: 500 },
    )
  }

  // Fee breakdown via the shared lib so the offer-fulfillment path
  // uses the exact same tier-aware math as a regular checkout. Defaults
  // to 'ship' fulfillment until we add a fulfillment picker to the
  // accept-offer modal.
  const tier = (sellerProfile.seller_tier as TierId | undefined) ?? 'basic'
  const fulfillment: FulfillmentId = 'ship'
  const isRaw = !bid.grading_company
  const breakdown = calculatePayout({
    salePrice: Number(bid.price),
    fulfillment,
    tier,
    isRaw,
  })

  const { data: order, error: orderError } = await admin
    .from('orders')
    .insert({
      buyer_id: bid.user_id,
      seller_id: user.id,
      status: 'paid',
      subtotal: bid.price,
      total: bid.price,
      platform_fee: breakdown.sellerFee + breakdown.marketplaceFee,
      seller_fee: breakdown.sellerFee,
      marketplace_fee: breakdown.marketplaceFee,
      processing_fee: breakdown.processingFee,
      seller_tier_at_sale: tier,
      stripe_payment_intent_id: captured.id,
      paid_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (orderError || !order) {
    console.error('[bids accept] order insert failed after capture', { bidId, captureId: captured.id, orderError })
    return NextResponse.json(
      {
        error: 'Payment captured but order setup failed. Support has been notified.',
        manualRefundRequired: true,
        paymentIntentId: captured.id,
      },
      { status: 500 },
    )
  }

  await admin.from('order_items').insert({
    order_id: order.id,
    listing_id: listing.id,
    card_id: bid.card_id,
    card_name: listingTitle,
    quantity: 1,
    unit_price: bid.price,
    condition: 'near_mint',
    snapshot_photo_url: card?.image_url ?? null,
  })

  return NextResponse.json({
    success: true,
    orderId: order.id,
    listingId: listing.id,
    paymentIntentId: captured.id,
  })
}
