import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { createShippingLabel } from '@/lib/shippo'
import { sendAdminSellerShippedEmail } from '@/lib/email'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fetch order
  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single()

  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  if (order.seller_id !== user.id) {
    return NextResponse.json({ error: 'Not your order' }, { status: 403 })
  }

  if (order.status !== 'paid') {
    return NextResponse.json({ error: 'Order is not in paid status' }, { status: 400 })
  }

  if (order.seller_label_url) {
    return NextResponse.json({ error: 'Label already generated' }, { status: 400 })
  }

  // Get seller's profile for address info
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  try {
    const { rateId } = await request.json()
    if (!rateId) {
      return NextResponse.json({ error: 'rateId is required' }, { status: 400 })
    }

    // Create the label
    const label = await createShippingLabel(rateId)

    // Update the order with label info and mark as shipped
    await supabase
      .from('orders')
      .update({
        seller_label_url: label.labelUrl,
        seller_label_cost: label.cost,
        seller_tracking_number: label.trackingNumber,
        seller_tracking_carrier: label.carrier,
        status: 'seller_shipped',
        shipped_at: new Date().toISOString(),
      })
      .eq('id', orderId)

    // Deduct flat $5 shipping fee from seller balance (nomi covers the rest)
    const SELLER_SHIPPING_FEE = 5
    await supabase
      .from('profiles')
      .update({
        balance: Number(profile.balance) - SELLER_SHIPPING_FEE,
      })
      .eq('id', user.id)

    // Notify admin that seller has shipped
    try {
      const adminEmail = process.env.ADMIN_EMAIL
      if (adminEmail) {
        const admin = getSupabaseAdmin()
        const { data: sellerProfile } = await admin
          .from('profiles')
          .select('display_name')
          .eq('id', user.id)
          .single()

        await sendAdminSellerShippedEmail({
          adminEmail,
          sellerName: sellerProfile?.display_name || '',
          orderId,
          trackingNumber: label.trackingNumber,
          trackingCarrier: label.carrier,
        })
      }
    } catch (emailErr) {
      console.error('Failed to send admin notification:', emailErr)
    }

    return NextResponse.json({
      label_url: label.labelUrl,
      tracking_number: label.trackingNumber,
      carrier: label.carrier,
      cost: label.cost,
    })
  } catch (err) {
    console.error('Label generation failed:', err)
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Label generation failed',
    }, { status: 500 })
  }
}
