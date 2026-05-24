/**
 * Cancel an order and reverse its side effects:
 *   1. Release reserved listing inventory back to active
 *   2. Refund any credits the buyer applied at checkout
 *   3. Set status to 'cancelled' with an admin_notes audit line
 *
 * Does NOT issue the Stripe card refund — that's the caller's concern,
 * because the trigger varies (Stripe initiates it on review.closed
 * refunded; we initiate it on EFW). Just cleans up our internal state
 * after the money has been (or will be) returned to the cardholder.
 *
 * Idempotent: if the order is already cancelled, returns without action.
 * Safe to call from webhook handlers that may fire multiple times.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { releaseReservation } from './inventory'

export async function cancelOrderWithRefund(
  supabase: SupabaseClient,
  orderId: string,
  reason: string,
): Promise<void> {
  const { data: order } = await supabase
    .from('orders')
    .select('id, buyer_id, status, credits_applied, inventory_reserved, items:order_items(listing_id, quantity)')
    .eq('id', orderId)
    .single()

  if (!order) return
  if (order.status === 'cancelled' || order.status === 'refunded') return

  // 1. Inventory release. Only orders that reserved inventory at creation
  //    actually decremented stock — legacy orders never reserved, so
  //    skip them to avoid a phantom restore.
  if (order.inventory_reserved && order.items) {
    for (const item of order.items) {
      const { data: cur } = await supabase
        .from('listings')
        .select('status, quantity_available')
        .eq('id', item.listing_id)
        .single()
      if (!cur) continue
      const release = releaseReservation(
        { status: cur.status, quantity_available: cur.quantity_available },
        item.quantity,
      )
      if (release) {
        await supabase
          .from('listings')
          .update({
            quantity_available: release.nextQuantityAvailable,
            status: release.nextStatus,
          })
          .eq('id', item.listing_id)
      }
    }
  }

  // 2. Credit refund. Same pattern as payment-intent's stale-order cleanup
  //    (src/app/api/stripe/payment-intent/route.ts:127–146) but called
  //    from a webhook context instead of a checkout entry.
  const credits = Number(order.credits_applied || 0)
  if (credits > 0 && order.buyer_id) {
    const { data: buyer } = await supabase
      .from('profiles')
      .select('balance')
      .eq('id', order.buyer_id)
      .single()
    await supabase
      .from('profiles')
      .update({ balance: Number(buyer?.balance || 0) + credits })
      .eq('id', order.buyer_id)
    await supabase.from('credit_transactions').insert({
      user_id: order.buyer_id,
      amount: credits,
      type: 'refund_credit',
      order_id: order.id,
      description: `Refund of credits — ${reason}`,
    })
  }

  // 3. Mark cancelled with audit trail
  await supabase
    .from('orders')
    .update({
      status: 'cancelled',
      admin_notes: `[auto-cancel] ${reason}`,
    })
    .eq('id', orderId)
}
