import { getSupabaseAdmin } from '@/lib/supabase/admin'

interface OrderItemForEntries {
  id: string
  quantity: number
}

/** Insert buyer/seller raffle entries for a freshly-authenticated order.
 *
 *  Rules: 1 entry per *card* (= one unit of order_item.quantity) for the
 *  buyer (source='purchase') and 1 entry per card for the seller
 *  (source='sale'). So a 3-item order with quantities [1,1,2] credits
 *  4 entries to the buyer and 4 entries to the seller.
 *
 *  Idempotent — if any purchase/sale entry already exists for this order
 *  on the active raffle, no-op. Lets the caller fire-and-forget without
 *  worrying about retries or status-flip races.
 *
 *  Skips entirely if buyer === seller (defensive — should never happen
 *  with our marketplace constraints, but a wash-trade slipping past
 *  shouldn't flood the raffle).
 *
 *  Never throws. Raffle entries are best-effort; an order completing
 *  successfully must not be held up by a raffle-insert failure. */
export async function recordOrderRaffleEntries({
  orderId,
  buyerId,
  sellerId,
  items,
}: {
  orderId: string
  buyerId: string
  sellerId: string
  items: OrderItemForEntries[]
}): Promise<void> {
  try {
    if (buyerId === sellerId) return
    if (items.length === 0) return

    const supabase = getSupabaseAdmin()

    const { data: raffle } = await supabase
      .from('raffles')
      .select('id')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!raffle) return

    const { count: existing } = await supabase
      .from('raffle_entries')
      .select('id', { count: 'exact', head: true })
      .eq('raffle_id', raffle.id)
      .eq('order_id', orderId)

    if ((existing ?? 0) > 0) return

    const rows: Array<{
      raffle_id: string
      user_id: string
      source: 'purchase' | 'sale'
      order_id: string
      order_item_id: string
    }> = []

    for (const item of items) {
      const qty = Math.max(1, Number(item.quantity) || 1)
      for (let i = 0; i < qty; i++) {
        rows.push({
          raffle_id: raffle.id,
          user_id: buyerId,
          source: 'purchase',
          order_id: orderId,
          order_item_id: item.id,
        })
        rows.push({
          raffle_id: raffle.id,
          user_id: sellerId,
          source: 'sale',
          order_id: orderId,
          order_item_id: item.id,
        })
      }
    }

    if (rows.length === 0) return

    const { error } = await supabase.from('raffle_entries').insert(rows)
    if (error) {
      console.error('[raffle] entry insert failed for order', orderId, error)
    }
  } catch (err) {
    console.error('[raffle] recordOrderRaffleEntries crashed for order', orderId, err)
  }
}
