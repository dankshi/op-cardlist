import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStripe, calculatePlatformFee } from '@/lib/stripe'

interface CartListing {
  id: string
  seller_id: string
  card_id: string
  title: string
  price: number
  condition: string
  photo_urls: string[]
  status: string
}

interface CartItemRow {
  listing: CartListing
  quantity: number
}

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get all active cart items
  const { data: cartItems } = await supabase
    .from('cart_items')
    .select('*, listing:listings(*)')
    .eq('user_id', user.id)

  const activeItems = (cartItems as CartItemRow[] | null)?.filter(
    (item) => item.listing?.status === 'active'
  )

  if (!activeItems?.length) {
    return NextResponse.json({ error: 'Cart is empty' }, { status: 400 })
  }

  // Group items by seller to create one order per seller
  const sellerGroups = new Map<string, CartItemRow[]>()
  for (const item of activeItems) {
    const sid = item.listing.seller_id
    if (!sellerGroups.has(sid)) sellerGroups.set(sid, [])
    sellerGroups.get(sid)!.push(item)
  }

  // Create orders for each seller
  const orderIds: string[] = []
  const allLineItems: { price_data: { currency: string; product_data: { name: string }; unit_amount: number }; quantity: number }[] = []

  for (const [sellerId, sellerItems] of sellerGroups) {
    const subtotal = sellerItems.reduce(
      (sum, item) => sum + item.quantity * Number(item.listing.price),
      0
    )
    const platformFee = calculatePlatformFee(subtotal)

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        buyer_id: user.id,
        seller_id: sellerId,
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

    orderIds.push(order.id)

    // Create order items
    const orderItems = sellerItems.map((item) => ({
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

    // Add to Stripe line items
    for (const item of sellerItems) {
      allLineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: item.listing.title },
          unit_amount: Math.round(Number(item.listing.price) * 100),
        },
        quantity: item.quantity,
      })
    }
  }

  // Create single Stripe Checkout Session for all items
  const origin = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

  const session = await getStripe().checkout.sessions.create({
    mode: 'payment',
    customer_email: user.email || undefined,
    line_items: allLineItems,
    shipping_address_collection: {
      allowed_countries: ['US'],
    },
    metadata: {
      order_ids: orderIds.join(','),
      buyer_id: user.id,
    },
    success_url: `${origin}/checkout/success?order_id=${orderIds[0]}`,
    cancel_url: `${origin}/checkout/cancel?order_id=${orderIds[0]}`,
  })

  return NextResponse.json({ url: session.url, order_ids: orderIds })
}
