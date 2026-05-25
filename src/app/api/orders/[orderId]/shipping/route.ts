import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { getStripe } from '@/lib/stripe'
import { getOutboundRates } from '@/lib/shippo'

/** Insure outbound shipments above this card-value threshold. Sub-$200
 *  packages cover the carrier base liability already; above that we want
 *  the parcel reimbursed if it's lost in transit. */
const INSURANCE_THRESHOLD = 200

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: order } = await supabase
    .from('orders')
    .select('buyer_id, status, subtotal, credits_applied, stripe_payment_intent_id')
    .eq('id', orderId)
    .single()

  if (!order || order.buyer_id !== user.id) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  if (order.status !== 'pending_payment') {
    return NextResponse.json({ error: 'Order cannot be modified' }, { status: 400 })
  }

  const body = await request.json()

  if (!body.name || !body.line1 || !body.city || !body.state || !body.zip || !body.phone) {
    return NextResponse.json({ error: 'Missing required address fields' }, { status: 400 })
  }

  const shippingAddress = {
    name: String(body.name),
    line1: String(body.line1),
    line2: body.line2 ? String(body.line2) : '',
    city: String(body.city),
    state: String(body.state),
    zip: String(body.zip),
    country: body.country ? String(body.country) : 'US',
    // USPS requires a recipient phone for the outbound label. Capture
    // it at checkout so admin doesn't have to chase the buyer at ship
    // time. Stored inside the JSONB blob to avoid a column migration.
    phone: String(body.phone),
  }

  // Quote outbound (Nomi → buyer) shipping live so the buyer's total
  // includes the real carrier cost. Without this we eat the outbound
  // label cost on every order. Insure when card value warrants it.
  const subtotal = Number(order.subtotal)
  let shippingCost: number
  let carrier: string
  let service: string
  let estimatedDays: number
  try {
    const rates = await getOutboundRates(
      {
        name: shippingAddress.name,
        street1: shippingAddress.line1,
        street2: shippingAddress.line2 || undefined,
        city: shippingAddress.city,
        state: shippingAddress.state,
        zip: shippingAddress.zip,
        country: shippingAddress.country,
      },
      {
        insuranceAmount: subtotal >= INSURANCE_THRESHOLD ? subtotal : undefined,
      },
    )
    const cheapest = rates[0]
    shippingCost = cheapest.estimatedCost
    carrier = cheapest.carrier
    service = cheapest.service
    estimatedDays = cheapest.estimatedDays
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to get shipping rate'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const creditsApplied = Number(order.credits_applied || 0)
  const newTotal = subtotal + shippingCost
  // Credits are spent against subtotal first; any remainder goes onto
  // the card on top of full shipping. Shippo cost is a real third-party
  // out-of-pocket so we never let credits eat it.
  const newCardAmount = Math.max(0, subtotal - creditsApplied) + shippingCost

  const { error: updateError } = await supabase
    .from('orders')
    .update({
      shipping_address: shippingAddress,
      shipping_cost: shippingCost,
      total: newTotal,
    })
    .eq('id', orderId)

  if (updateError) {
    return NextResponse.json({ error: 'Failed to save address' }, { status: 500 })
  }

  // Update the Stripe PaymentIntent so charge matches the new total.
  // The intent was created with subtotal-only at /api/stripe/payment-intent;
  // we re-amount it here once we know shipping. Use admin client only for
  // the order metadata — the Stripe call uses the platform key.
  if (order.stripe_payment_intent_id) {
    try {
      await getStripe().paymentIntents.update(order.stripe_payment_intent_id, {
        amount: Math.round(newCardAmount * 100),
      })
    } catch (err) {
      // Roll back the address save so we don't end up with a quoted
      // shipping cost the buyer never actually paid for.
      const admin = getSupabaseAdmin()
      await admin
        .from('orders')
        .update({ shipping_cost: 0, total: subtotal })
        .eq('id', orderId)
      const message = err instanceof Error ? err.message : 'Failed to update payment'
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }

  return NextResponse.json({
    ok: true,
    shippingCost,
    carrier,
    service,
    estimatedDays,
    cardAmount: newCardAmount,
    total: newTotal,
  })
}
