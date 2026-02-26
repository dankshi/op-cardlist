import { NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
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
      const orderId = session.metadata?.order_id

      if (orderId) {
        // Update order status to paid
        await supabase
          .from('orders')
          .update({
            status: 'paid',
            stripe_payment_intent_id: session.payment_intent as string,
            paid_at: new Date().toISOString(),
          })
          .eq('id', orderId)

        // Get order items and update listing quantities
        const { data: items } = await supabase
          .from('order_items')
          .select('listing_id, quantity')
          .eq('order_id', orderId)

        if (items) {
          for (const item of items) {
            // Decrement available quantity
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
        }

        // Remove purchased items from buyer's cart
        const buyerId = session.metadata?.buyer_id
        const sellerId = session.metadata?.seller_id

        if (buyerId && sellerId) {
          // Get all listing IDs from this order
          const listingIds = items?.map(i => i.listing_id) || []
          if (listingIds.length > 0) {
            await supabase
              .from('cart_items')
              .delete()
              .eq('user_id', buyerId)
              .in('listing_id', listingIds)
          }
        }

        // Increment seller's total_sales
        if (session.metadata?.seller_id) {
          const { data: sellerProfile } = await supabase
            .from('profiles')
            .select('total_sales')
            .eq('id', session.metadata.seller_id)
            .single()

          if (sellerProfile) {
            await supabase
              .from('profiles')
              .update({ total_sales: (sellerProfile.total_sales || 0) + 1 })
              .eq('id', session.metadata.seller_id)
          }
        }
      }
      break
    }

    case 'account.updated': {
      const account = event.data.object as Stripe.Account
      if (account.charges_enabled && account.payouts_enabled) {
        // Mark seller as fully onboarded
        await supabase
          .from('profiles')
          .update({ stripe_onboarding_complete: true })
          .eq('stripe_account_id', account.id)
      }
      break
    }
  }

  return NextResponse.json({ received: true })
}
