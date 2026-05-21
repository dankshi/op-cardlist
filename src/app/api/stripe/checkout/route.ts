import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { getStripe } from '@/lib/stripe'
import { calculatePayout, type FulfillmentId, type TierId } from '@/lib/fees'
import { reserveListing, releaseReservation } from '@/lib/inventory'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { listing_id, quantity = 1 } = await request.json()

  if (!listing_id) {
    return NextResponse.json({ error: 'listing_id is required' }, { status: 400 })
  }

  // Fetch the listing
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

  // Reserve inventory atomically — same pattern as payment-intent.
  const reservation = reserveListing(
    { status: listing.status, quantity_available: listing.quantity_available },
    quantity,
  )
  if (!reservation) {
    return NextResponse.json({ error: 'Listing is no longer available' }, { status: 400 })
  }
  const admin = getSupabaseAdmin()
  const { data: reservedRows, error: reserveError } = await admin
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

  // Tier-aware fee calculation (mirrors payment-intent route). Falls back
  // to safe defaults if the seller hasn't been tiered yet.
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
  const platformFee = breakdown.sellerFee + breakdown.marketplaceFee

  // Create the order
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
      inventory_reserved: true,
    })
    .select()
    .single()

  if (orderError || !order) {
    // Roll back the reservation so the listing doesn't get stuck.
    const { data: cur } = await admin
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
        await admin
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

  // Create order item
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

  // Create Stripe Checkout Session
  const origin = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

  const session = await getStripe().checkout.sessions.create({
    mode: 'payment',
    customer_email: user.email || undefined,
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: { name: listing.title },
          unit_amount: Math.round(Number(listing.price) * 100),
        },
        quantity,
      },
    ],
    shipping_address_collection: {
      allowed_countries: ['US'],
    },
    metadata: {
      order_ids: order.id,
      buyer_id: user.id,
    },
    success_url: `${origin}/checkout/success?order_id=${order.id}`,
    cancel_url: `${origin}/checkout/cancel?order_id=${order.id}`,
  })

  return NextResponse.json({ url: session.url, order_id: order.id })
}
