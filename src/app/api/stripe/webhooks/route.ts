import { NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { sendSellerNewOrderEmail, sendBuyerReceiptEmail } from '@/lib/email'
import { tierForGmv } from '@/lib/fees'
import { finalizeSale } from '@/lib/inventory'
import type { ShippingAddress } from '@/types/database'
import type { SupabaseClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

/**
 * Add this order's subtotal to the seller's lifetime GMV and auto-promote
 * their tier if a threshold is crossed. P2P-only tiers (Elite) are never
 * granted here — those require manual partner approval.
 */
async function bumpSellerGmvAndTier(
  supabase: SupabaseClient,
  sellerId: string,
  subtotal: number,
) {
  if (subtotal <= 0) return

  const { data: seller } = await supabase
    .from('profiles')
    .select('seller_gmv, seller_tier')
    .eq('id', sellerId)
    .single()

  if (!seller) return

  const currentGmv = Number(seller.seller_gmv) || 0
  const currentTier = seller.seller_tier as string
  const newGmv = Math.round((currentGmv + subtotal) * 100) / 100
  const eligibleTier = tierForGmv(newGmv)

  // Don't demote anyone who's been manually promoted (e.g. Elite). Only
  // update tier if the GMV-derived tier is strictly better than current.
  const tierOrder = ['basic', 'silver', 'pearl', 'gold', 'diamond']
  const currentRank = tierOrder.indexOf(currentTier)
  const eligibleRank = tierOrder.indexOf(eligibleTier)
  const shouldPromote = currentRank >= 0 && eligibleRank > currentRank

  await supabase
    .from('profiles')
    .update({
      seller_gmv: newGmv,
      ...(shouldPromote ? { seller_tier: eligibleTier } : {}),
    })
    .eq('id', sellerId)
}

async function processOrderPayment(
  supabase: SupabaseClient,
  orderId: string,
  buyerId: string | null,
  paymentIntentId: string,
  shippingAddress: ShippingAddress | null
) {
  // Check idempotency — skip if already paid
  const { data: existingOrder } = await supabase
    .from('orders')
    .select('status, inventory_reserved')
    .eq('id', orderId)
    .single()

  if (!existingOrder || existingOrder.status !== 'pending_payment') return

  // Update order status to paid
  await supabase
    .from('orders')
    .update({
      status: 'paid',
      stripe_payment_intent_id: paymentIntentId,
      paid_at: new Date().toISOString(),
      ...(shippingAddress ? { shipping_address: shippingAddress } : {}),
    })
    .eq('id', orderId)

  // Settle listing inventory + status. For orders created with the
  // reserve-on-create flow, stock was already decremented up front — we
  // just finalize the status here. Legacy orders (predating that flow)
  // fall back to the old decrement-then-flip behavior so in-flight pre-
  // refactor orders still land correctly.
  const { data: items } = await supabase
    .from('order_items')
    .select('listing_id, quantity')
    .eq('order_id', orderId)

  if (items) {
    for (const item of items) {
      const { data: listing } = await supabase
        .from('listings')
        .select('status, quantity_available')
        .eq('id', item.listing_id)
        .single()

      if (!listing) continue

      if (existingOrder.inventory_reserved) {
        // New flow: stock already subtracted — just settle status.
        const nextStatus = finalizeSale({
          status: listing.status,
          quantity_available: listing.quantity_available,
        })
        await supabase
          .from('listings')
          .update({ status: nextStatus })
          .eq('id', item.listing_id)
      } else {
        // Legacy flow: decrement now and flip status the old way.
        const newQty = listing.quantity_available - item.quantity
        await supabase
          .from('listings')
          .update({
            quantity_available: Math.max(0, newQty),
            status: newQty <= 0 ? 'sold' : 'active',
          })
          .eq('id', item.listing_id)
      }
    }
  }

  // Send email notifications
  const { data: order } = await supabase
    .from('orders')
    .select('seller_id, subtotal, total, platform_fee, shipping_address')
    .eq('id', orderId)
    .single()

  // Bump the seller's lifetime GMV + auto-promote tier on every paid order.
  if (order?.seller_id) {
    try {
      await bumpSellerGmvAndTier(supabase, order.seller_id, Number(order.subtotal))
    } catch (gmvErr) {
      // GMV is best-effort — don't break the payment flow if it fails.
      console.error('Failed to bump seller GMV:', gmvErr)
    }
  }

  if (order) {
    try {
      const { data: orderItems } = await supabase
        .from('order_items')
        .select('card_name, quantity, unit_price, condition')
        .eq('order_id', orderId)

      const [sellerAuth, buyerAuth] = await Promise.all([
        supabase.auth.admin.getUserById(order.seller_id),
        buyerId ? supabase.auth.admin.getUserById(buyerId) : null,
      ])

      const [sellerProfileData, buyerProfileData] = await Promise.all([
        supabase.from('profiles').select('display_name').eq('id', order.seller_id).single(),
        buyerId
          ? supabase.from('profiles').select('display_name').eq('id', buyerId).single()
          : null,
      ])

      const sellerEmail = sellerAuth?.data?.user?.email
      const buyerEmail = buyerAuth?.data?.user?.email
      const emailItems = (orderItems || []).map((i) => ({
        card_name: i.card_name,
        quantity: i.quantity,
        unit_price: i.unit_price,
        condition: i.condition,
      }))

      // Use the shipping address from the order (may have been saved by custom checkout)
      const finalShippingAddress = shippingAddress || (order.shipping_address as ShippingAddress | null)

      if (sellerEmail) {
        await sendSellerNewOrderEmail({
          sellerEmail,
          sellerName: sellerProfileData?.data?.display_name || '',
          orderId,
          items: emailItems,
          total: Number(order.total),
          platformFee: Number(order.platform_fee),
          buyerName: buyerProfileData?.data?.display_name || '',
          shippingAddress: finalShippingAddress,
        })
      }

      if (buyerEmail) {
        await sendBuyerReceiptEmail({
          buyerEmail,
          buyerName: buyerProfileData?.data?.display_name || '',
          orderId,
          items: emailItems,
          total: Number(order.total),
          sellerName: sellerProfileData?.data?.display_name || '',
        })
      }
    } catch (emailErr) {
      console.error('Failed to send order emails:', emailErr)
    }
  }
}

export async function POST(request: Request) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  let event: Stripe.Event

  try {
    event = getStripe().webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session

      const orderIds = session.metadata?.order_ids
        ? session.metadata.order_ids.split(',')
        : session.metadata?.order_id
          ? [session.metadata.order_id]
          : []

      if (orderIds.length === 0) break

      const buyerId = session.metadata?.buyer_id || null

      // Retrieve shipping details from Stripe hosted checkout
      const fullSession = await getStripe().checkout.sessions.retrieve(session.id, {
        expand: ['collected_information'],
      })

      let shippingAddress: ShippingAddress | null = null
      const stripeShipping = fullSession.collected_information?.shipping_details
      if (stripeShipping?.address) {
        shippingAddress = {
          name: stripeShipping.name || '',
          line1: stripeShipping.address.line1 || '',
          line2: stripeShipping.address.line2 || '',
          city: stripeShipping.address.city || '',
          state: stripeShipping.address.state || '',
          zip: stripeShipping.address.postal_code || '',
          country: stripeShipping.address.country || 'US',
        }
      }

      for (const orderId of orderIds) {
        await processOrderPayment(supabase, orderId, buyerId, session.payment_intent as string, shippingAddress)
      }
      break
    }

    case 'payment_intent.succeeded': {
      const paymentIntent = event.data.object as Stripe.PaymentIntent

      const orderId = paymentIntent.metadata?.order_id
      const buyerId = paymentIntent.metadata?.buyer_id || null

      if (!orderId) break

      // Shipping address already saved by custom checkout form — pass null here
      await processOrderPayment(supabase, orderId, buyerId, paymentIntent.id, null)
      break
    }
  }

  return NextResponse.json({ received: true })
}
