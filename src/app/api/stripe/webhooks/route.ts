import { NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { sendSellerNewOrderEmail, sendBuyerReceiptEmail } from '@/lib/email'
import type { ShippingAddress } from '@/types/database'
import Stripe from 'stripe'

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

      // Support both single order_id (legacy) and comma-separated order_ids
      const orderIds = session.metadata?.order_ids
        ? session.metadata.order_ids.split(',')
        : session.metadata?.order_id
          ? [session.metadata.order_id]
          : []

      if (orderIds.length === 0) break

      const buyerId = session.metadata?.buyer_id

      // Retrieve shipping details from Stripe
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

      // Process each order
      for (const orderId of orderIds) {
        // Update order status to paid + shipping address
        await supabase
          .from('orders')
          .update({
            status: 'paid',
            stripe_payment_intent_id: session.payment_intent as string,
            paid_at: new Date().toISOString(),
            ...(shippingAddress ? { shipping_address: shippingAddress } : {}),
          })
          .eq('id', orderId)

        // Get order items and update listing quantities
        const { data: items } = await supabase
          .from('order_items')
          .select('listing_id, quantity')
          .eq('order_id', orderId)

        if (items) {
          for (const item of items) {
            const { data: listing } = await supabase
              .from('listings')
              .select('quantity_available')
              .eq('id', item.listing_id)
              .single()

            if (listing) {
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

          // Remove purchased items from buyer's cart
          if (buyerId) {
            const listingIds = items.map(i => i.listing_id)
            if (listingIds.length > 0) {
              await supabase
                .from('cart_items')
                .delete()
                .eq('user_id', buyerId)
                .in('listing_id', listingIds)
            }
          }
        }

        // Get order to find seller and credit balance
        const { data: order } = await supabase
          .from('orders')
          .select('seller_id, total, platform_fee')
          .eq('id', orderId)
          .single()

        if (order) {
          const { data: sellerProfile } = await supabase
            .from('profiles')
            .select('total_sales, balance')
            .eq('id', order.seller_id)
            .single()

          if (sellerProfile) {
            const sellerCredit = Number(order.total) - Number(order.platform_fee)
            await supabase
              .from('profiles')
              .update({
                total_sales: (sellerProfile.total_sales || 0) + 1,
                balance: Number(sellerProfile.balance || 0) + sellerCredit,
              })
              .eq('id', order.seller_id)
          }

          // Send email notifications
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

            if (sellerEmail) {
              await sendSellerNewOrderEmail({
                sellerEmail,
                sellerName: sellerProfileData?.data?.display_name || '',
                orderId,
                items: emailItems,
                total: Number(order.total),
                platformFee: Number(order.platform_fee),
                buyerName: buyerProfileData?.data?.display_name || '',
                shippingAddress,
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
      break
    }
  }

  return NextResponse.json({ received: true })
}
