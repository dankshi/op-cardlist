import { NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { cancelOrderWithRefund } from '@/lib/orderCancel'
import { finalizeOrderAsPaid } from '@/lib/orderPayment'
import type { ShippingAddress } from '@/types/database'
import type { SupabaseClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

/**
 * Move an order into the `under_review` state with Radar metadata. Called
 * from `review.opened` and from `payment_intent.succeeded` when the
 * latest charge has `outcome.type === 'manual_review'`. Suppresses the
 * normal paid-state side effects (seller email, inventory finalize) —
 * those will fire later in `processOrderPayment` if the review approves.
 *
 * Idempotent: if the order has progressed past under_review (rare race —
 * review opened after we already marked paid), we don't downgrade.
 */
async function markOrderUnderReview(
  supabase: SupabaseClient,
  orderId: string,
  review: {
    id: string | null
    reason: string | null
    risk_score: number | null
    risk_level: string | null
  },
) {
  const { data: existing } = await supabase
    .from('orders')
    .select('status')
    .eq('id', orderId)
    .single()

  if (!existing) return
  if (existing.status !== 'pending_payment' && existing.status !== 'under_review') return

  await supabase
    .from('orders')
    .update({
      status: 'under_review',
      stripe_review_id: review.id,
      review_reason: review.reason,
      risk_score: review.risk_score,
      risk_level: review.risk_level,
      review_opened_at: new Date().toISOString(),
    })
    .eq('id', orderId)
}

/**
 * Look up the latest charge for a PaymentIntent and return Radar review
 * metadata if one is open. Used by `payment_intent.succeeded` to decide
 * whether to skip the paid-state transition.
 */
async function getOpenReviewForPaymentIntent(
  paymentIntent: Stripe.PaymentIntent,
): Promise<{ id: string | null; reason: string | null; risk_score: number | null; risk_level: string | null } | null> {
  const chargeId = typeof paymentIntent.latest_charge === 'string'
    ? paymentIntent.latest_charge
    : paymentIntent.latest_charge?.id
  if (!chargeId) return null

  const charge = await getStripe().charges.retrieve(chargeId, {
    expand: ['review'],
  })

  // outcome.type === 'manual_review' is the canonical "needs review" signal.
  // The expanded review object gives us the rev_XXX id + reason for our DB.
  if (charge.outcome?.type !== 'manual_review') return null

  const review = charge.review as Stripe.Review | string | null | undefined
  const reviewObj = typeof review === 'object' ? review : null
  return {
    id: typeof review === 'string' ? review : reviewObj?.id ?? null,
    reason: reviewObj?.reason ?? null,
    risk_score: charge.outcome?.risk_score ?? null,
    risk_level: charge.outcome?.risk_level ?? null,
  }
}

async function processOrderPayment(
  supabase: SupabaseClient,
  orderId: string,
  buyerId: string | null,
  paymentIntentId: string,
  shippingAddress: ShippingAddress | null
) {
  // Check idempotency — only pending_payment orders progress here via the
  // webhook. under_review orders are deliberately NOT accepted: they need
  // explicit approval (Stripe Radar review.closed=approved or admin-inbox
  // approve action), which calls finalizeOrderAsPaid directly, bypassing
  // this guard.
  const { data: existingOrder } = await supabase
    .from('orders')
    .select('status')
    .eq('id', orderId)
    .single()

  if (!existingOrder || existingOrder.status !== 'pending_payment') return

  await finalizeOrderAsPaid(supabase, orderId, buyerId, paymentIntentId, shippingAddress)
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

      // If Radar opened a review on this charge, defer the paid transition
      // until review.closed (approved). The seller email + inventory
      // finalize must wait so they don't ship/get notified for orders
      // that might be refunded for fraud.
      const openReview = await getOpenReviewForPaymentIntent(paymentIntent)
      if (openReview) {
        await markOrderUnderReview(supabase, orderId, openReview)
        break
      }

      // No review — normal flow. Shipping address already saved by custom
      // checkout form (Stripe Elements), so pass null.
      await processOrderPayment(supabase, orderId, buyerId, paymentIntent.id, null)
      break
    }

    case 'review.opened': {
      // Stripe Radar opened a manual review on a charge. Find the order
      // via the charge's payment_intent metadata and move it to under_review.
      // This may fire before or after payment_intent.succeeded — both paths
      // are idempotent so order doesn't matter.
      const review = event.data.object as Stripe.Review
      const piId = typeof review.payment_intent === 'string'
        ? review.payment_intent
        : review.payment_intent?.id
      if (!piId) break

      const pi = await getStripe().paymentIntents.retrieve(piId)
      const orderId = pi.metadata?.order_id
      if (!orderId) break

      // Pull risk_score/risk_level off the underlying charge so the
      // /admin/risk inbox can sort by score.
      const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id
      const charge = chargeId ? await getStripe().charges.retrieve(chargeId) : null

      await markOrderUnderReview(supabase, orderId, {
        id: review.id,
        reason: review.reason ?? null,
        risk_score: charge?.outcome?.risk_score ?? null,
        risk_level: charge?.outcome?.risk_level ?? null,
      })
      break
    }

    case 'review.closed': {
      // Manual reviewer (founder in admin inbox) approved or refunded.
      const review = event.data.object as Stripe.Review
      const piId = typeof review.payment_intent === 'string'
        ? review.payment_intent
        : review.payment_intent?.id
      if (!piId) break

      const pi = await getStripe().paymentIntents.retrieve(piId)
      const orderId = pi.metadata?.order_id
      const buyerId = pi.metadata?.buyer_id || null
      if (!orderId) break

      const closedReason = review.closed_reason ?? null

      // Stamp review_closed_at + closed_reason regardless of outcome —
      // the admin inbox uses this to filter resolved reviews.
      await supabase
        .from('orders')
        .update({
          review_closed_at: new Date().toISOString(),
          review_closed_reason: closedReason,
        })
        .eq('id', orderId)

      if (closedReason === 'approved') {
        // Run the deferred paid-state transition: status→paid, seller email,
        // inventory finalize, GMV bump. Call finalizeOrderAsPaid directly
        // because the source state is under_review (processOrderPayment's
        // guard would reject it).
        const { data: cur } = await supabase
          .from('orders')
          .select('status')
          .eq('id', orderId)
          .single()
        if (cur?.status === 'under_review') {
          await finalizeOrderAsPaid(supabase, orderId, buyerId, piId, null)
        }
      } else if (closedReason === 'refunded' || closedReason === 'refunded_as_fraud') {
        // Stripe initiated the card refund itself when the reviewer clicked
        // "refund" in the dashboard. We just clean up our internal state.
        await cancelOrderWithRefund(supabase, orderId, `review_closed: ${closedReason}`)
      }
      // 'disputed' or 'redacted' — let the dispute event flow or admin
      // handle it; nothing to do here.
      break
    }

    case 'radar.early_fraud_warning.created': {
      // Card issuer told Stripe the card was reported stolen. Refund
      // proactively to avoid the chargeback fee + potential VAMP impact.
      const efw = event.data.object as Stripe.Radar.EarlyFraudWarning
      const chargeId = typeof efw.charge === 'string' ? efw.charge : efw.charge?.id
      if (!chargeId) break

      const charge = await getStripe().charges.retrieve(chargeId)
      const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id
      if (!piId) break

      const pi = await getStripe().paymentIntents.retrieve(piId)
      const orderId = pi.metadata?.order_id
      if (!orderId) break

      // Issue the card refund first — if this fails we don't want to mark
      // the order cancelled because the buyer hasn't actually been refunded.
      try {
        await getStripe().refunds.create({
          payment_intent: piId,
          reason: 'fraudulent',
        })
      } catch (refundErr) {
        console.error(`EFW: refund failed for order ${orderId}:`, refundErr)
        break
      }

      await cancelOrderWithRefund(supabase, orderId, 'early_fraud_warning')
      break
    }

    case 'charge.dispute.created': {
      // Bank-initiated chargeback. Refund-via-Stripe has already happened
      // automatically on Stripe's side (funds frozen). Mark our order as
      // disputed so the seller-payout path skips it and admin can see it.
      const dispute = event.data.object as Stripe.Dispute
      const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id
      if (!chargeId) break

      const charge = await getStripe().charges.retrieve(chargeId)
      const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id
      if (!piId) break

      const pi = await getStripe().paymentIntents.retrieve(piId)
      const orderId = pi.metadata?.order_id
      if (!orderId) break

      await supabase
        .from('orders')
        .update({
          status: 'disputed',
          admin_notes: `[dispute] reason=${dispute.reason} amount=${dispute.amount / 100}`,
        })
        .eq('id', orderId)
      break
    }
  }

  return NextResponse.json({ received: true })
}
