import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStripe, calculatePlatformFee } from '@/lib/stripe'

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

  const subtotal = quantity * Number(listing.price)
  const platformFee = calculatePlatformFee(subtotal)

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      buyer_id: user.id,
      seller_id: listing.seller_id,
      status: 'pending_payment',
      subtotal,
      platform_fee: platformFee,
      total: subtotal,
    })
    .select()
    .single()

  if (orderError || !order) {
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

  const paymentIntent = await getStripe().paymentIntents.create({
    amount: Math.round(subtotal * 100),
    currency: 'usd',
    automatic_payment_methods: { enabled: true },
    metadata: {
      order_id: order.id,
      buyer_id: user.id,
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
    total: subtotal,
  })
}
