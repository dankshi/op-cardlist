import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { getStripe } from '@/lib/stripe'
import { cancelOrderWithRefund } from '@/lib/orderCancel'

/**
 * Refund an under_review order from the /admin/risk inbox.
 *
 * Always issues the Stripe card refund first (with reason='fraudulent'
 * so it counts against the cardholder's fraud history at the issuer),
 * then cleans up our internal state (release inventory + refund credits
 * + set order to cancelled).
 *
 * If a Stripe Radar review is open on the charge, the refund will
 * automatically close it as `refunded_as_fraud` — no separate API call
 * needed.
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
    .select('id, status, stripe_payment_intent_id')
    .eq('id', orderId)
    .single()

  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.status !== 'under_review') {
    return NextResponse.json({ error: `Order is not under review (status: ${order.status})` }, { status: 400 })
  }
  if (!order.stripe_payment_intent_id) {
    return NextResponse.json({ error: 'Order has no payment intent — cannot refund via Stripe' }, { status: 400 })
  }

  try {
    await getStripe().refunds.create({
      payment_intent: order.stripe_payment_intent_id,
      reason: 'fraudulent',
    })
  } catch (err) {
    console.error(`[admin/risk/refund] Stripe refund failed for ${orderId}:`, err)
    return NextResponse.json({ error: 'Stripe refund failed — check logs' }, { status: 500 })
  }

  await cancelOrderWithRefund(admin, orderId, 'admin_risk_review_refund')

  return NextResponse.json({ ok: true })
}
