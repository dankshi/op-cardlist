/**
 * Paid-state finalization for orders. Shared between the Stripe webhook
 * handler (auto-paid on PI success, deferred-paid on review.closed=approved)
 * and the /admin/risk approve action (manual approval of an under_review
 * order that had no Stripe Radar review to approve via API).
 *
 * Neither function has a state guard — callers verify source state. The
 * webhook's `processOrderPayment` wrapper enforces pending_payment-only;
 * other callers (review.closed, admin approve) verify under_review.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { tierForGmv } from './fees'
import { finalizeSale } from './inventory'
import { sendSellerNewOrderEmail, sendBuyerReceiptEmail } from './email'
import type { ShippingAddress } from '@/types/database'

/**
 * Add this order's subtotal to the seller's lifetime GMV and auto-promote
 * their tier if a threshold is crossed. P2P-only tiers (Elite) are never
 * granted here — those require manual partner approval.
 */
export async function bumpSellerGmvAndTier(
  supabase: SupabaseClient,
  sellerId: string,
  subtotal: number,
) {
  if (subtotal <= 0) return

  const { data: seller } = await supabase
    .from('profiles')
    .select('seller_gmv, seller_tier')
    .eq('id', sellerId)
    .single()

  if (!seller) return

  const currentGmv = Number(seller.seller_gmv) || 0
  const currentTier = seller.seller_tier as string
  const newGmv = Math.round((currentGmv + subtotal) * 100) / 100
  const eligibleTier = tierForGmv(newGmv)

  // Don't demote anyone who's been manually promoted (e.g. Elite). Only
  // update tier if the GMV-derived tier is strictly better than current.
  const tierOrder = ['basic', 'silver', 'pearl', 'gold', 'diamond']
  const currentRank = tierOrder.indexOf(currentTier)
  const eligibleRank = tierOrder.indexOf(eligibleTier)
  const shouldPromote = currentRank >= 0 && eligibleRank > currentRank

  await supabase
    .from('profiles')
    .update({
      seller_gmv: newGmv,
      ...(shouldPromote ? { seller_tier: eligibleTier } : {}),
    })
    .eq('id', sellerId)
}

/**
 * Apply the paid-state side effects to an order:
 *   1. status → paid, paid_at set, stripe_payment_intent_id stamped
 *   2. settle listing inventory (reserved → sold/active)
 *   3. bump seller GMV + tier
 *   4. send seller new-order + buyer receipt emails
 *
 * Has NO state guard — callers must check the source state themselves.
 */
export async function finalizeOrderAsPaid(
  supabase: SupabaseClient,
  orderId: string,
  buyerId: string | null,
  paymentIntentId: string,
  shippingAddress: ShippingAddress | null,
) {
  const { data: existingOrder } = await supabase
    .from('orders')
    .select('inventory_reserved')
    .eq('id', orderId)
    .single()
  if (!existingOrder) return

  await supabase
    .from('orders')
    .update({
      status: 'paid',
      stripe_payment_intent_id: paymentIntentId,
      paid_at: new Date().toISOString(),
      ...(shippingAddress ? { shipping_address: shippingAddress } : {}),
    })
    .eq('id', orderId)

  // Settle listing inventory + status. New orders reserved stock at
  // creation, so we only settle status; legacy orders fall back to the
  // old decrement-then-flip behavior.
  const { data: items } = await supabase
    .from('order_items')
    .select('listing_id, quantity')
    .eq('order_id', orderId)

  if (items) {
    for (const item of items) {
      const { data: listing } = await supabase
        .from('listings')
        .select('status, quantity_available')
        .eq('id', item.listing_id)
        .single()
      if (!listing) continue

      if (existingOrder.inventory_reserved) {
        const nextStatus = finalizeSale({
          status: listing.status,
          quantity_available: listing.quantity_available,
        })
        await supabase
          .from('listings')
          .update({ status: nextStatus })
          .eq('id', item.listing_id)
      } else {
        const newQty = listing.quantity_available - item.quantity
        await supabase
          .from('listings')
          .update({
            quantity_available: Math.max(0, newQty),
            status: newQty <= 0 ? 'sold' : 'active',
          })
          .eq('id', item.listing_id)
      }
    }
  }

  const { data: order } = await supabase
    .from('orders')
    .select('seller_id, subtotal, total, platform_fee, shipping_address')
    .eq('id', orderId)
    .single()

  if (order?.seller_id) {
    try {
      await bumpSellerGmvAndTier(supabase, order.seller_id, Number(order.subtotal))
    } catch (gmvErr) {
      // GMV is best-effort — don't break the payment flow if it fails.
      console.error('Failed to bump seller GMV:', gmvErr)
    }
  }

  if (order) {
    try {
      const { data: orderItems } = await supabase
        .from('order_items')
        .select('card_name, quantity, unit_price, condition')
        .eq('order_id', orderId)

      const [sellerAuth, buyerAuth] = await Promise.all([
        supabase.auth.admin.getUserById(order.seller_id),
        buyerId ? supabase.auth.admin.getUserById(buyerId) : null,
      ])

      const [sellerProfileData, buyerProfileData] = await Promise.all([
        supabase.from('profiles').select('display_name').eq('id', order.seller_id).single(),
        buyerId
          ? supabase.from('profiles').select('display_name').eq('id', buyerId).single()
          : null,
      ])

      const sellerEmail = sellerAuth?.data?.user?.email
      const buyerEmail = buyerAuth?.data?.user?.email
      const emailItems = (orderItems || []).map((i) => ({
        card_name: i.card_name,
        quantity: i.quantity,
        unit_price: i.unit_price,
        condition: i.condition,
      }))

      const finalShippingAddress = shippingAddress || (order.shipping_address as ShippingAddress | null)

      if (sellerEmail) {
        await sendSellerNewOrderEmail({
          sellerEmail,
          sellerName: sellerProfileData?.data?.display_name || '',
          orderId,
          items: emailItems,
          total: Number(order.total),
          platformFee: Number(order.platform_fee),
          buyerName: buyerProfileData?.data?.display_name || '',
          shippingAddress: finalShippingAddress,
        })
      }

      if (buyerEmail) {
        await sendBuyerReceiptEmail({
          buyerEmail,
          buyerName: buyerProfileData?.data?.display_name || '',
          orderId,
          items: emailItems,
          total: Number(order.total),
          sellerName: sellerProfileData?.data?.display_name || '',
        })
      }
    } catch (emailErr) {
      console.error('Failed to send order emails:', emailErr)
    }
  }
}
