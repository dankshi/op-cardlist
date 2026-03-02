import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
    .select('buyer_id, status')
    .eq('id', orderId)
    .single()

  if (!order || order.buyer_id !== user.id) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  if (order.status !== 'pending_payment') {
    return NextResponse.json({ error: 'Order cannot be modified' }, { status: 400 })
  }

  const body = await request.json()

  if (!body.name || !body.line1 || !body.city || !body.state || !body.zip) {
    return NextResponse.json({ error: 'Missing required address fields' }, { status: 400 })
  }

  const { error: updateError } = await supabase
    .from('orders')
    .update({
      shipping_address: {
        name: body.name,
        line1: body.line1,
        line2: body.line2 || '',
        city: body.city,
        state: body.state,
        zip: body.zip,
        country: body.country || 'US',
      },
    })
    .eq('id', orderId)

  if (updateError) {
    return NextResponse.json({ error: 'Failed to save address' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
