import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Buyer confirms delivery of an order. Flips status → 'delivered' and, on the
 * first confirmation, auto-adds each item to the buyer's collection with the
 * price they paid as cost basis. Idempotent: only acts while the order is
 * 'shipped_to_buyer', so re-POSTing after delivery is a no-op (never
 * double-counts the collection).
 *
 * All writes are the buyer's own rows (orders buyer RLS + collections owner
 * RLS via the increment RPC), so the session client suffices — no service role.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select('id, buyer_id, status')
    .eq('id', orderId)
    .single()

  if (orderErr || !order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.buyer_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Idempotency guard: only the shipped→delivered transition does work.
  if (order.status === 'delivered') {
    return NextResponse.json({ ok: true, alreadyDelivered: true })
  }
  if (order.status !== 'shipped_to_buyer') {
    return NextResponse.json({ error: `Cannot confirm delivery from status "${order.status}"` }, { status: 409 })
  }

  const deliveredAt = new Date().toISOString()
  const { error: updErr } = await supabase
    .from('orders')
    .update({ status: 'delivered', delivered_at: deliveredAt })
    .eq('id', orderId)
    .eq('status', 'shipped_to_buyer') // optimistic lock against double-fire
  if (updErr) return NextResponse.json({ error: 'Failed to update order' }, { status: 500 })

  // Auto-add items to the collection (best-effort — a collection hiccup must
  // not undo a confirmed delivery, so we don't fail the request on it).
  const { data: items } = await supabase
    .from('order_items')
    .select('card_id, condition, quantity, unit_price')
    .eq('order_id', orderId)

  const acquiredDate = deliveredAt.slice(0, 10)
  for (const item of items ?? []) {
    if (!item.card_id) continue
    const { error: rpcErr } = await supabase.rpc('upsert_collection_increment', {
      p_card_id: item.card_id,
      p_condition: item.condition ?? null,
      p_quantity: item.quantity ?? 1,
      p_acquired_price: item.unit_price ?? null,
      p_acquired_date: acquiredDate,
      p_acquired_via: 'purchase',
      p_order_id: orderId,
    })
    if (rpcErr) console.error('collection auto-add failed', { orderId, card: item.card_id, rpcErr })
  }

  return NextResponse.json({ ok: true, delivered_at: deliveredAt })
}
