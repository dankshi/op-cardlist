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

  const { orderItemId, isDamaged, damageNotes } = await request.json()

  if (!orderItemId) {
    return NextResponse.json({ error: 'orderItemId is required' }, { status: 400 })
  }

  const { data: item } = await supabase
    .from('order_items')
    .select('id, order_id, card_name')
    .eq('id', orderItemId)
    .single()

  if (!item) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  }

  const { error: updateError } = await supabase
    .from('order_items')
    .update({
      is_damaged: !!isDamaged,
      damage_notes: isDamaged ? (damageNotes || null) : null,
    })
    .eq('id', orderItemId)

  if (updateError) {
    return NextResponse.json({ error: 'Failed to update damage' }, { status: 500 })
  }

  await supabase.from('intake_activity_log').insert({
    order_id: item.order_id,
    order_item_id: orderItemId,
    action: isDamaged ? 'item_damaged' : 'item_damage_cleared',
    details: {
      card_name: item.card_name,
      damage_notes: isDamaged ? damageNotes : null,
    },
    performed_by: user.id,
  })

  return NextResponse.json({ success: true })
}
