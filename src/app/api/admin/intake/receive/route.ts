import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
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

  const { orderId, receivedVia } = await request.json()

  if (!orderId) {
    return NextResponse.json({ error: 'orderId is required' }, { status: 400 })
  }

  // Fetch the order
  const { data: order } = await supabase
    .from('orders')
    .select('id, status')
    .eq('id', orderId)
    .single()

  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  // Only allow receiving orders that are in seller_shipped or paid status
  if (!['paid', 'seller_shipped'].includes(order.status)) {
    // If already received, just return success (idempotent)
    if (order.status === 'received') {
      return NextResponse.json({ success: true, already_received: true })
    }
    return NextResponse.json(
      { error: `Cannot receive order in '${order.status}' status` },
      { status: 400 }
    )
  }

  const now = new Date().toISOString()

  const { error: updateError } = await supabase
    .from('orders')
    .update({
      status: 'received',
      received_at: now,
      received_via: receivedVia || 'manual',
    })
    .eq('id', orderId)

  if (updateError) {
    console.error('Receive error:', updateError)
    return NextResponse.json({ error: 'Failed to update order' }, { status: 500 })
  }

  // Log the action
  await supabase.from('intake_activity_log').insert({
    order_id: orderId,
    action: 'package_received',
    details: {
      received_via: receivedVia || 'manual',
    },
    performed_by: user.id,
  })

  return NextResponse.json({ success: true })
}
