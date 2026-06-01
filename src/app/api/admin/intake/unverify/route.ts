import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Revert a batch of items from `verified` back to `pending` — the Undo for
// an implicit verify commit (see /verify-order). Scoped to the exact item
// ids the client just auto-verified, and only touches rows still in
// `verified` state (so we never clobber a flag/resolution applied since).
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

  const { orderItemIds } = await request.json()
  if (!Array.isArray(orderItemIds) || orderItemIds.length === 0) {
    return NextResponse.json({ error: 'orderItemIds is required' }, { status: 400 })
  }

  const { data: reverted, error } = await supabase
    .from('order_items')
    .update({
      intake_status: 'pending',
      intake_verified_at: null,
      intake_verified_by: null,
    })
    .in('id', orderItemIds)
    .eq('intake_status', 'verified')
    .select('id, order_id')

  if (error) {
    return NextResponse.json({ error: 'Failed to revert items' }, { status: 500 })
  }

  const orderId = reverted?.[0]?.order_id
  if (orderId && reverted && reverted.length > 0) {
    await supabase.from('intake_activity_log').insert({
      order_id: orderId,
      action: 'items_unverified',
      details: { count: reverted.length, undo: true },
      performed_by: user.id,
    })
  }

  return NextResponse.json({ success: true, revertedItemIds: (reverted || []).map(i => i.id) })
}
