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

  const { orderId, cardName, cardId, condition, quantity, unitPrice, notes } = await request.json()

  if (!orderId || !cardName) {
    return NextResponse.json({ error: 'orderId and cardName are required' }, { status: 400 })
  }

  // Verify order exists
  const { data: order } = await supabase
    .from('orders')
    .select('id, status')
    .eq('id', orderId)
    .single()

  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  // Create new order item
  const { data: newItem, error: insertError } = await supabase
    .from('order_items')
    .insert({
      order_id: orderId,
      listing_id: '00000000-0000-0000-0000-000000000000', // placeholder for admin-added items
      card_id: cardId || 'admin-added',
      card_name: cardName,
      quantity: quantity || 1,
      unit_price: unitPrice || 0,
      condition: condition || 'near_mint',
      intake_status: 'verified',
      intake_verified_at: new Date().toISOString(),
      intake_verified_by: user.id,
      intake_notes: notes || 'Added by admin during intake',
    })
    .select()
    .single()

  if (insertError) {
    return NextResponse.json({ error: 'Failed to add item' }, { status: 500 })
  }

  // Log the action
  await supabase.from('intake_activity_log').insert({
    order_id: orderId,
    order_item_id: newItem.id,
    action: 'item_added',
    details: {
      card_name: cardName,
      card_id: cardId,
      condition,
      quantity: quantity || 1,
      unit_price: unitPrice || 0,
      notes,
    },
    performed_by: user.id,
  })

  return NextResponse.json({ success: true, item: newItem })
}
