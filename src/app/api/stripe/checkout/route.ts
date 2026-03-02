import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStripe, calculatePlatformFee } from '@/lib/stripe'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { seller_id } = await request.json()

  if (!seller_id) {
    return NextResponse.json({ error: 'seller_id required' }, { status: 400 })
  }

  // Get seller's Stripe account
  const { data: seller } = await supabase
    .from('profiles')
    .select('stripe_account_id, stripe_onboarding_complete, display_name')
    .eq('id', seller_id)
    .single()

  if (!seller?.stripe_account_id || !seller?.stripe_onboarding_complete) {
    return NextResponse.json({ error: 'Seller not set up for payments' }, { status: 400 })
  }

  // Get cart items for this seller
  const { data: cartItems } = await supabase
    .from('cart_items')
    .select('*, listing:listings(*)')
    .eq('user_id', user.id)

  const sellerItems = cartItems?.filter(
    (item: { listing: { seller_id: string; status: string } }) =>
      item.listing?.seller_id === seller_id && item.listing?.status === 'active'
  )

  if (!sellerItems?.length) {
    return NextResponse.json({ error: 'No items from this seller' }, { status: 400 })
  }

  // Calculate totals
  const subtotal = sellerItems.reduce(
    (sum: number, item: { quantity: number; listing: { price: number } }) =>
      sum + item.quantity * Number(item.listing.price),
    0
  )
  const platformFee = calculatePlatformFee(subtotal)
  const total = subtotal // Shipping to be added later

  // Create order
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      buyer_id: user.id,
      seller_id,
      status: 'pending_payment',
      subtotal,
      platform_fee: platformFee,
      total,
    })
    .select()
    .single()

  if (orderError || !order) {
    return NextResponse.json({ error: 'Failed to create order' }, { status: 500 })
  }

  // Create order items
  const orderItems = sellerItems.map((item: { listing: { id: string; card_id: string; title: string; price: number; condition: string; photo_urls: string[] }; quantity: number }) => ({
    order_id: order.id,
    listing_id: item.listing.id,
    card_id: item.listing.card_id,
    card_name: item.listing.title,
    quantity: item.quantity,
    unit_price: item.listing.price,
    condition: item.listing.condition,
    snapshot_photo_url: item.listing.photo_urls?.[0] || null,
  }))

  await supabase.from('order_items').insert(orderItems)

  // Create Stripe Checkout Session
  const origin = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

  const session = await getStripe().checkout.sessions.create({
    mode: 'payment',
    customer_email: user.email || undefined,
    line_items: sellerItems.map((item: { listing: { title: string; price: number }; quantity: number }) => ({
      price_data: {
        currency: 'usd',
        product_data: {
          name: item.listing.title,
        },
        unit_amount: Math.round(Number(item.listing.price) * 100),
      },
      quantity: item.quantity,
    })),
    shipping_address_collection: {
      allowed_countries: ['US'],
    },
    payment_intent_data: {
      application_fee_amount: Math.round(platformFee * 100),
      transfer_data: {
        destination: seller.stripe_account_id,
      },
    },
    metadata: {
      order_id: order.id,
      buyer_id: user.id,
      seller_id,
    },
    success_url: `${origin}/checkout/success?order_id=${order.id}`,
    cancel_url: `${origin}/checkout/cancel?order_id=${order.id}`,
  })

  return NextResponse.json({ url: session.url, order_id: order.id })
}
