import type { getSupabaseAdmin } from '@/lib/supabase/admin'
import type { Order } from '@/types/database'

type AdminClient = ReturnType<typeof getSupabaseAdmin>

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Collection P&L, Phase 1 (see docs/collection-pnl.md).
 *
 * Records a `collection_sales` disposition for each line of a Nomi order that
 * the seller listed from their collection — mirroring the buyer-side auto-add
 * in confirm-delivery. Closes the collection line's lots (oldest first) to get
 * the cost basis, allocates the order's fees across lines by gross, and stores
 * the realized gain.
 *
 * Best-effort + idempotent: skips a line already recorded (so a re-run of the
 * order-status route never double-books or double-closes lots), and the caller
 * wraps this so a failure never blocks the seller credit. Runs on the
 * service-role client — it reads/writes the seller's rows and calls the
 * security-definer close function.
 */
export async function recordSaleDispositions(admin: AdminClient, order: Order): Promise<void> {
  const { data: items } = await admin
    .from('order_items')
    .select('listing_id, card_id, quantity, unit_price, listings(collection_id, grading_company, grade)')
    .eq('order_id', order.id)
  if (!items?.length) return

  const orderGross = Number(order.subtotal) ||
    items.reduce((s, it) => s + Number(it.unit_price) * (it.quantity || 1), 0)
  // Mirror the seller-credit fee math in the status route: legacy orders
  // (no tier snapshot) carried only platform_fee + a separate $5 ship fee;
  // tier-aware orders store platform_fee + processing_fee explicitly.
  const isLegacy = order.seller_tier_at_sale == null
  const orderFees = isLegacy
    ? Number(order.platform_fee || 0) + 5
    : Number(order.platform_fee || 0) + Number(order.processing_fee || 0)
  const soldAt = order.authenticated_at ?? new Date().toISOString()

  for (const it of items) {
    const listing = Array.isArray(it.listings) ? it.listings[0] : it.listings
    const qty = it.quantity || 1

    // Idempotency: skip if this (order, listing) line is already recorded —
    // before closing any lots.
    const { data: existing } = await admin
      .from('collection_sales')
      .select('id')
      .eq('order_id', order.id)
      .eq('listing_id', it.listing_id)
      .maybeSingle()
    if (existing) continue

    const collectionId = (listing as { collection_id?: string | null } | null)?.collection_id ?? null
    let basis: number | null = null
    if (collectionId) {
      const { data } = await admin.rpc('close_collection_lots', {
        p_collection_id: collectionId,
        p_quantity: qty,
      })
      basis = data == null ? null : Number(data)
    }

    const gross = Number(it.unit_price) * qty
    const fees = orderGross > 0 ? (orderFees * gross) / orderGross : 0
    const net = gross - fees

    await admin.from('collection_sales').insert({
      user_id: order.seller_id,
      card_id: it.card_id,
      collection_id: collectionId,
      order_id: order.id,
      listing_id: it.listing_id,
      channel: 'nomi',
      quantity: qty,
      gross_proceeds: round2(gross),
      fees: round2(fees),
      net_proceeds: round2(net),
      cost_basis: basis,
      grading_company: (listing as { grading_company?: string | null } | null)?.grading_company ?? null,
      grade: (listing as { grade?: string | null } | null)?.grade ?? null,
      sold_at: soldAt,
    })
  }
}
