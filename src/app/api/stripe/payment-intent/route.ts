import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { getStripe } from '@/lib/stripe'
import { calculatePayout, type FulfillmentId, type TierId } from '@/lib/fees'
import { reserveListing, releaseReservation } from '@/lib/inventory'

// Stripe requires a minimum charge of $0.50. We leave at least $1 on the card to be safe.
const MIN_CARD_AMOUNT = 1

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { listing_id, quantity = 1, credits_applied: requestedCredits = 0 } = await request.json()

  if (!listing_id) {
    return NextResponse.json({ error: 'listing_id is required' }, { status: 400 })
  }

  const { data: listing, error: listingError } = await supabase
    .from('listings')
    .select('*')
    .eq('id', listing_id)
    .single()

  if (listingError || !listing) {
    return NextResponse.json({ error: 'Listing not found' }, { status: 404 })
  }

  if (listing.status !== 'active') {
    return NextResponse.json({ error: 'Listing is no longer available' }, { status: 400 })
  }

  if (quantity > listing.quantity_available) {
    return NextResponse.json({ error: 'Not enough stock' }, { status: 400 })
  }

  if (listing.seller_id === user.id) {
    return NextResponse.json({ error: 'You cannot buy your own listing' }, { status: 400 })
  }

  // Atomically reserve the inventory. The WHERE clause re-checks the
  // status + quantity that reserveListing() based its decision on, so
  // a concurrent buyer who got there first will leave us with 0 rows
  // matched and we refuse the order.
  const reservation = reserveListing(
    { status: listing.status, quantity_available: listing.quantity_available },
    quantity,
  )
  if (!reservation) {
    return NextResponse.json({ error: 'Listing is no longer available' }, { status: 400 })
  }
  const reserveAdmin = getSupabaseAdmin()
  const { data: reservedRows, error: reserveError } = await reserveAdmin
    .from('listings')
    .update({
      quantity_available: reservation.nextQuantityAvailable,
      status: reservation.nextStatus,
    })
    .eq('id', listing.id)
    .eq('status', listing.status)
    .gte('quantity_available', quantity)
    .select('id')
  if (reserveError || !reservedRows || reservedRows.length === 0) {
    return NextResponse.json({ error: 'Listing was just bought by another shopper. Please try again.' }, { status: 409 })
  }

  const subtotal = quantity * Number(listing.price)

  // Tier-aware fee calculation. Falls back to safe defaults if the seller
  // hasn't been tiered yet or the listing predates the fulfillment column.
  const { data: sellerProfile } = await supabase
    .from('profiles')
    .select('seller_tier')
    .eq('id', listing.seller_id)
    .single()
  const sellerTier = (sellerProfile?.seller_tier as TierId | undefined) ?? 'basic'
  const fulfillment = (listing.fulfillment_method as FulfillmentId | undefined) ?? 'ship'
  const isRaw = !listing.grading_company

  const breakdown = calculatePayout({
    salePrice: subtotal,
    fulfillment,
    tier: sellerTier,
    isRaw,
  })
  // platform_fee stays as what Nomi collects (seller_fee + marketplace_fee).
  // Processing is paid to Stripe, not Nomi.
  const platformFee = breakdown.sellerFee + breakdown.marketplaceFee

  // Validate & cap credits against current buyer balance and Stripe minimum
  const { data: buyerProfile } = await supabase
    .from('profiles')
    .select('balance')
    .eq('id', user.id)
    .single()

  const availableBalance = Number(buyerProfile?.balance || 0)
  const maxApplicable = Math.max(0, subtotal - MIN_CARD_AMOUNT)
  const creditsApplied = Math.max(
    0,
    Math.min(Number(requestedCredits) || 0, availableBalance, maxApplicable),
  )
  const cardAmount = subtotal - creditsApplied

  const admin = getSupabaseAdmin()

  // Check for existing pending order for this buyer + listing
  const { data: existingOrders } = await supabase
    .from('orders')
    .select('id, stripe_payment_intent_id, credits_applied, inventory_reserved, items:order_items(listing_id, quantity)')
    .eq('buyer_id', user.id)
    .eq('status', 'pending_payment')
    .order('created_at', { ascending: false })

  // Cancel stale pending orders for this buyer + listing, refunding any
  // credits AND releasing the reserved inventory back to the listing.
  const staleOrders = (existingOrders || []).filter(o =>
    o.items?.some((item: { listing_id: string }) => item.listing_id === listing_id)
  )

  for (const stale of staleOrders) {
    const staleCredits = Number(stale.credits_applied || 0)
    if (staleCredits > 0) {
      const { data: refundProfile } = await supabase
        .from('profiles')
        .select('balance')
        .eq('id', user.id)
        .single()
      await supabase
        .from('profiles')
        .update({ balance: Number(refundProfile?.balance || 0) + staleCredits })
        .eq('id', user.id)
      await admin.from('credit_transactions').insert({
        user_id: user.id,
        amount: staleCredits,
        type: 'refund_credit',
        order_id: stale.id,
        description: 'Refund of credits from cancelled checkout',
      })
    }
    // Release any reserved inventory back to the listing. Only orders
    // tagged inventory_reserved actually decremented stock; older orders
    // never reserved, so skip them to avoid a phantom restore.
    if (stale.inventory_reserved) {
      for (const item of stale.items ?? []) {
        const { data: cur } = await admin
          .from('listings')
          .select('status, quantity_available')
          .eq('id', item.listing_id)
          .single()
        if (!cur) continue
        const release = releaseReservation(
          { status: cur.status, quantity_available: cur.quantity_available },
          item.quantity,
        )
        if (release) {
          await admin
            .from('listings')
            .update({
              quantity_available: release.nextQuantityAvailable,
              status: release.nextStatus,
            })
            .eq('id', item.listing_id)
        }
      }
    }
    await supabase
      .from('orders')
      .update({ status: 'cancelled' })
      .eq('id', stale.id)
  }

  // Create new order
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      buyer_id: user.id,
      seller_id: listing.seller_id,
      status: 'pending_payment',
      subtotal,
      platform_fee: platformFee,
      seller_fee: breakdown.sellerFee,
      marketplace_fee: breakdown.marketplaceFee,
      processing_fee: breakdown.processingFee,
      seller_tier_at_sale: sellerTier,
      total: subtotal,
      credits_applied: creditsApplied,
      inventory_reserved: true,
    })
    .select()
    .single()

  if (orderError || !order) {
    // We already reserved stock above — roll it back so the listing
    // doesn't get stuck in `reserved` with no order behind it.
    const { data: cur } = await reserveAdmin
      .from('listings')
      .select('status, quantity_available')
      .eq('id', listing.id)
      .single()
    if (cur) {
      const release = releaseReservation(
        { status: cur.status, quantity_available: cur.quantity_available },
        quantity,
      )
      if (release) {
        await reserveAdmin
          .from('listings')
          .update({
            quantity_available: release.nextQuantityAvailable,
            status: release.nextStatus,
          })
          .eq('id', listing.id)
      }
    }
    return NextResponse.json({ error: 'Failed to create order' }, { status: 500 })
  }

  await supabase.from('order_items').insert({
    order_id: order.id,
    listing_id: listing.id,
    card_id: listing.card_id,
    card_name: listing.title,
    quantity,
    unit_price: listing.price,
    condition: listing.condition,
    snapshot_photo_url: listing.photo_urls?.[0] || null,
  })

  // Debit credits from buyer balance now; we'll refund on cancel above if checkout is abandoned
  if (creditsApplied > 0) {
    await supabase
      .from('profiles')
      .update({ balance: availableBalance - creditsApplied })
      .eq('id', user.id)
    await admin.from('credit_transactions').insert({
      user_id: user.id,
      amount: -creditsApplied,
      type: 'purchase_spent',
      order_id: order.id,
      description: 'Credits applied at checkout',
    })
  }

  const paymentIntent = await getStripe().paymentIntents.create({
    amount: Math.round(cardAmount * 100),
    currency: 'usd',
    automatic_payment_methods: { enabled: true },
    metadata: {
      order_id: order.id,
      buyer_id: user.id,
      credits_applied: String(creditsApplied),
    },
  })

  await supabase
    .from('orders')
    .update({ stripe_payment_intent_id: paymentIntent.id })
    .eq('id', order.id)

  return NextResponse.json({
    clientSecret: paymentIntent.client_secret,
    orderId: order.id,
    listing: {
      title: listing.title,
      price: Number(listing.price),
      photo_url: listing.photo_urls?.[0] || null,
      condition: listing.condition,
      grading_company: listing.grading_company || null,
      grade: listing.grade || null,
      quantity,
    },
    subtotal,
    creditsApplied,
    cardAmount,
    availableBalance: availableBalance - creditsApplied,
    total: subtotal,
  })
}
