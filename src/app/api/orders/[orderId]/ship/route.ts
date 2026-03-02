import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { sendAdminSellerShippedEmail } from '@/lib/email'

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

  // Get the order and verify seller owns it
  const { data: order } = await supabase
    .from('orders')
    .select('id, buyer_id, seller_id, status, seller_label_url, seller_tracking_number, seller_tracking_carrier')
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

  if (!order.seller_label_url) {
    return NextResponse.json({ error: 'You must generate a shipping label first' }, { status: 400 })
  }

  // Update order to seller_shipped
  const { error: updateError } = await supabase
    .from('orders')
    .update({
      status: 'seller_shipped',
      shipped_at: new Date().toISOString(),
    })
    .eq('id', orderId)

  if (updateError) {
    return NextResponse.json({ error: 'Failed to update order' }, { status: 500 })
  }

  // Notify admin that seller has shipped
  try {
    const admin = getSupabaseAdmin()
    const { data: sellerProfile } = await admin
      .from('profiles')
      .select('display_name')
      .eq('id', order.seller_id)
      .single()

    const adminEmail = process.env.ADMIN_EMAIL
    if (adminEmail) {
      await sendAdminSellerShippedEmail({
        adminEmail,
        sellerName: sellerProfile?.display_name || '',
        orderId,
        trackingNumber: order.seller_tracking_number,
        trackingCarrier: order.seller_tracking_carrier,
      })
    }
  } catch (emailErr) {
    console.error('Failed to send admin notification:', emailErr)
  }

  return NextResponse.json({ success: true })
}
