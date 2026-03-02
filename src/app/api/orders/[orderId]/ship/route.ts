import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { sendBuyerShippedEmail } from '@/lib/email'

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

  const { tracking_number, tracking_carrier } = await request.json()

  // Get the order and verify seller owns it
  const { data: order } = await supabase
    .from('orders')
    .select('id, buyer_id, seller_id, status')
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

  // Update order to shipped
  const { error: updateError } = await supabase
    .from('orders')
    .update({
      status: 'shipped',
      tracking_number: tracking_number || null,
      tracking_carrier: tracking_carrier || null,
      shipped_at: new Date().toISOString(),
    })
    .eq('id', orderId)

  if (updateError) {
    return NextResponse.json({ error: 'Failed to update order' }, { status: 500 })
  }

  // Send buyer notification email
  try {
    const admin = getSupabaseAdmin()
    const { data: buyerAuth } = await admin.auth.admin.getUserById(order.buyer_id)
    const buyerEmail = buyerAuth?.user?.email

    const [buyerProfile, sellerProfile] = await Promise.all([
      admin.from('profiles').select('display_name').eq('id', order.buyer_id).single(),
      admin.from('profiles').select('display_name').eq('id', order.seller_id).single(),
    ])

    if (buyerEmail) {
      await sendBuyerShippedEmail({
        buyerEmail,
        buyerName: buyerProfile.data?.display_name || '',
        orderId,
        sellerName: sellerProfile.data?.display_name || '',
        trackingNumber: tracking_number,
        trackingCarrier: tracking_carrier,
      })
    }
  } catch (emailErr) {
    console.error('Failed to send shipped email:', emailErr)
  }

  return NextResponse.json({ success: true })
}
