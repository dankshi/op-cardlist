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

  const { orderItemId, notes } = await request.json()

  if (!orderItemId) {
    return NextResponse.json({ error: 'orderItemId is required' }, { status: 400 })
  }

  // Fetch the item to get order_id
  const { data: item } = await supabase
    .from('order_items')
    .select('*, order:orders!inner(id, status)')
    .eq('id', orderItemId)
    .single()

  if (!item) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  }

  if (item.intake_status === 'verified') {
    return NextResponse.json({ error: 'Item already verified' }, { status: 400 })
  }

  const now = new Date().toISOString()

  // Update item intake status
  const { error: updateError } = await supabase
    .from('order_items')
    .update({
      intake_status: 'verified',
      intake_verified_at: now,
      intake_verified_by: user.id,
      intake_notes: notes || null,
    })
    .eq('id', orderItemId)

  if (updateError) {
    return NextResponse.json({ error: 'Failed to verify item' }, { status: 500 })
  }

  // Log the action
  await supabase.from('intake_activity_log').insert({
    order_id: item.order_id,
    order_item_id: orderItemId,
    action: 'item_verified',
    details: {
      card_name: item.card_name,
      notes: notes || null,
    },
    performed_by: user.id,
  })

  return NextResponse.json({ success: true })
}
