import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { createOutboundLabel } from '@/lib/shippo'

/** Admin-only: generate (or regenerate) the platform→buyer label.
 *  Lets ops print the outbound label from the admin order detail page
 *  *before* transitioning the order to shipped_to_buyer — which is what
 *  the warehouse actually needs (label first, status update after the
 *  package is handed to the carrier). */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: order } = await supabase
    .from('orders')
    .select('id, status, buyer_id, shipping_address')
    .eq('id', orderId)
    .single()

  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  if (!order.shipping_address) {
    return NextResponse.json({ error: 'Order is missing a shipping address' }, { status: 400 })
  }

  // Sanity check status — generating an outbound label only makes sense
  // once the card has been authenticated. Block earlier states so a
  // misclick doesn't burn a label on an unverified order.
  if (!['authenticated', 'shipped_to_buyer'].includes(order.status)) {
    return NextResponse.json({
      error: `Cannot print outbound label while order is in '${order.status}'. Authenticate the card first.`,
    }, { status: 400 })
  }

  // Buyer's email isn't on the order record — pull it from auth.users.
  // USPS requires recipient email + phone for label generation; missing
  // either rejects the rate quote with the misleading "Seller info
  // missing email or phone" message.
  const adminClient = getSupabaseAdmin()
  const buyerAuth = await adminClient.auth.admin.getUserById(order.buyer_id)
  const buyerEmail = buyerAuth?.data?.user?.email

  if (!buyerEmail) {
    return NextResponse.json({
      error: 'Buyer email not found — required for shipping label.',
    }, { status: 400 })
  }

  const buyerAddr = order.shipping_address as {
    name: string; line1: string; line2?: string; city: string;
    state: string; zip: string; country: string; phone?: string
  }

  // Phone should have been captured at checkout in the shipping_address
  // JSON. Older orders / seed data may not have it — surface a clear
  // error rather than letting Shippo's cryptic message bubble up.
  if (!buyerAddr.phone) {
    return NextResponse.json({
      error: 'Buyer phone not on file — required for USPS label. Update the order\'s shipping address with a phone number and retry.',
    }, { status: 400 })
  }

  try {
    const label = await createOutboundLabel({
      name: buyerAddr.name,
      street1: buyerAddr.line1,
      street2: buyerAddr.line2 || undefined,
      city: buyerAddr.city,
      state: buyerAddr.state,
      zip: buyerAddr.zip,
      country: buyerAddr.country || 'US',
      email: buyerEmail,
      phone: buyerAddr.phone,
    })

    await supabase
      .from('orders')
      .update({
        tracking_number: label.trackingNumber,
        tracking_carrier: label.carrier,
        outbound_label_url: label.labelUrl,
        outbound_label_cost: label.cost,
      })
      .eq('id', orderId)

    return NextResponse.json({
      label_url: label.labelUrl,
      tracking_number: label.trackingNumber,
      carrier: label.carrier,
      cost: label.cost,
    })
  } catch (err) {
    console.error('Admin outbound label generation failed:', err)
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Label generation failed',
    }, { status: 500 })
  }
}
