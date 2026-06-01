import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Batch-verify every still-pending item on an order in one shot. This is
// the "implicit verify" commit: at intake we verify by exception — the
// operator only flags problems, and moving on to the next package (or
// hitting Next Package) marks everything they DIDN'T flag as verified.
// Intake is not the authenticity gate (that's /admin/authenticate), so a
// light contents/condition pass here is appropriate.
//
// Only flips `pending` → `verified`; flagged / resolved / rejected items
// are left untouched. Returns the affected item ids so the client can
// offer a one-tap Undo.
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

  const { orderId } = await request.json()
  if (!orderId) {
    return NextResponse.json({ error: 'orderId is required' }, { status: 400 })
  }

  const now = new Date().toISOString()

  const { data: updated, error } = await supabase
    .from('order_items')
    .update({
      intake_status: 'verified',
      intake_verified_at: now,
      intake_verified_by: user.id,
    })
    .eq('order_id', orderId)
    .eq('intake_status', 'pending')
    .select('id, card_name')

  if (error) {
    return NextResponse.json({ error: 'Failed to verify items' }, { status: 500 })
  }

  const verifiedItemIds = (updated || []).map(i => i.id)

  // One activity-log row summarizing the batch verify.
  if (verifiedItemIds.length > 0) {
    await supabase.from('intake_activity_log').insert({
      order_id: orderId,
      action: 'items_verified',
      details: { count: verifiedItemIds.length, implicit: true },
      performed_by: user.id,
    })
  }

  return NextResponse.json({ success: true, verifiedItemIds, count: verifiedItemIds.length })
}
