import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { createOutboundLabel } from '@/lib/shippo'
import {
  sendSellerStatusUpdateEmail,
  sendBuyerShippedToBuyerEmail,
} from '@/lib/email'

const VALID_TRANSITIONS: Record<string, string> = {
  seller_shipped: 'received',
  received: 'authenticated',
  authenticated: 'shipped_to_buyer',
}

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

  // Check admin
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { status, notes } = await request.json()

  // Fetch order
  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single()

  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  // Validate transition
  const expectedNext = VALID_TRANSITIONS[order.status]
  if (status !== expectedNext) {
    return NextResponse.json({
      error: `Cannot transition from ${order.status} to ${status}. Expected: ${expectedNext}`,
    }, { status: 400 })
  }

  const adminSupabase = getSupabaseAdmin()
  const now = new Date().toISOString()

  // Build update object
  const update: Record<string, unknown> = { status }

  if (status === 'received') {
    update.received_at = now
  } else if (status === 'authenticated') {
    // Check that all items have been verified or resolved before authenticating
    const { data: items } = await supabase
      .from('order_items')
      .select('id, intake_status, card_name')
      .eq('order_id', orderId)

    const unverifiedItems = (items || []).filter(
      i => i.intake_status !== 'verified' && i.intake_status !== 'resolved'
    )

    if (unverifiedItems.length > 0) {
      const names = unverifiedItems.map(i => i.card_name).join(', ')
      return NextResponse.json({
        error: `Cannot authenticate: ${unverifiedItems.length} item(s) not yet verified — ${names}`,
      }, { status: 400 })
    }

    update.authenticated_at = now

    // Credit seller balance now that card is authenticated
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
  } else if (status === 'shipped_to_buyer') {
    update.shipped_to_buyer_at = now

    // Generate outbound label (platform → buyer)
    if (order.shipping_address) {
      try {
        const buyerAddr = order.shipping_address as { name: string; line1: string; line2?: string; city: string; state: string; zip: string; country: string }
        const label = await createOutboundLabel({
          name: buyerAddr.name,
          street1: buyerAddr.line1,
          street2: buyerAddr.line2 || undefined,
          city: buyerAddr.city,
          state: buyerAddr.state,
          zip: buyerAddr.zip,
          country: buyerAddr.country || 'US',
        })
        update.tracking_number = label.trackingNumber
        update.tracking_carrier = label.carrier
      } catch (err) {
        console.error('Outbound label generation failed:', err)
        // Still update status but without auto-generated tracking
      }
    }
  }

  // Append admin notes
  if (notes) {
    const timestamp = new Date().toLocaleString('en-US')
    const existingNotes = order.admin_notes || ''
    update.admin_notes = existingNotes
      ? `${existingNotes}\n---\n[${timestamp}] ${notes}`
      : `[${timestamp}] ${notes}`
  }

  const { error: updateError } = await supabase
    .from('orders')
    .update(update)
    .eq('id', orderId)

  if (updateError) {
    return NextResponse.json({ error: 'Failed to update order' }, { status: 500 })
  }

  // Send email notifications
  try {
    if (status === 'received' || status === 'authenticated') {
      // Notify seller
      const sellerAuth = await adminSupabase.auth.admin.getUserById(order.seller_id)
      const { data: sellerProfileData } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', order.seller_id)
        .single()

      const sellerEmail = sellerAuth?.data?.user?.email
      if (sellerEmail) {
        await sendSellerStatusUpdateEmail({
          sellerEmail,
          sellerName: sellerProfileData?.display_name || '',
          orderId,
          status,
        })
      }
    }

    if (status === 'shipped_to_buyer') {
      // Notify buyer
      const buyerId = order.buyer_id
      const buyerAuth = await adminSupabase.auth.admin.getUserById(buyerId)
      const { data: buyerProfileData } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', buyerId)
        .single()

      const buyerEmail = buyerAuth?.data?.user?.email
      if (buyerEmail) {
        await sendBuyerShippedToBuyerEmail({
          buyerEmail,
          buyerName: buyerProfileData?.display_name || '',
          orderId,
          trackingNumber: (update.tracking_number as string) || null,
          trackingCarrier: (update.tracking_carrier as string) || null,
        })
      }
    }
  } catch (emailErr) {
    console.error('Failed to send status update email:', emailErr)
  }

  return NextResponse.json({ success: true, status })
}
