import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { getStripe } from '@/lib/stripe'
import { finalizeOrderAsPaid } from '@/lib/orderPayment'

/**
 * Approve an under_review order from the /admin/risk inbox.
 *
 * Two cases:
 *   1. Stripe Radar opened a review (stripe_review_id is set). Call
 *      stripe.reviews.approve so the dashboard/Radar UI stays in sync;
 *      Stripe will fire review.closed=approved which our webhook already
 *      handles. We ALSO call finalizeOrderAsPaid here directly for
 *      immediate response — finalize is idempotent (paid orders skip
 *      seller email re-send via the source-state check at the call site).
 *
 *   2. Marketplace risk only (stripe_review_id is null). No Stripe review
 *      to approve via API; we just finalize directly.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = getSupabaseAdmin()
  const { data: order } = await admin
    .from('orders')
    .select('id, status, buyer_id, stripe_review_id, stripe_payment_intent_id')
    .eq('id', orderId)
    .single()

  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.status !== 'under_review') {
    return NextResponse.json({ error: `Order is not under review (status: ${order.status})` }, { status: 400 })
  }

  // If Stripe opened the review, mark it approved on their side too so
  // the Radar dashboard stays in sync.
  if (order.stripe_review_id) {
    try {
      await getStripe().reviews.approve(order.stripe_review_id)
    } catch (err) {
      console.error(`[admin/risk/approve] Stripe reviews.approve failed for ${order.stripe_review_id}:`, err)
      // Don't fail the request — Stripe-side state can be reconciled later
      // and our DB state is what matters for our payout/shipping pipeline.
    }
  }

  await admin
    .from('orders')
    .update({
      review_closed_at: new Date().toISOString(),
      review_closed_reason: 'approved',
    })
    .eq('id', orderId)

  await finalizeOrderAsPaid(admin, orderId, order.buyer_id, order.stripe_payment_intent_id ?? '', null)

  return NextResponse.json({ ok: true })
}
