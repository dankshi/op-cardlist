import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { createOutboundLabel } from '@/lib/shippo'
import { notifyLabelFailure } from '@/lib/slack'
import {
  sendSellerStatusUpdateEmail,
  sendBuyerShippedToBuyerEmail,
  sendBuyerReceivedEmail,
  sendBuyerAuthenticatedEmail,
} from '@/lib/email'
import { recordOrderRaffleEntries } from '@/lib/raffle'

const VALID_TRANSITIONS: Record<string, string> = {
  seller_shipped: 'received',
  received: 'authenticated',
  authenticated: 'shipped_to_buyer',
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check admin
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { status, notes } = await request.json()

  // Fetch order
  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single()

  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  // Validate transition
  const expectedNext = VALID_TRANSITIONS[order.status]
  if (status !== expectedNext) {
    return NextResponse.json({
      error: `Cannot transition from ${order.status} to ${status}. Expected: ${expectedNext}`,
    }, { status: 400 })
  }

  const adminSupabase = getSupabaseAdmin()
  const now = new Date().toISOString()

  // Build update object
  const update: Record<string, unknown> = { status }

  if (status === 'received') {
    update.received_at = now
  } else if (status === 'authenticated') {
    // Check that all items have been verified or resolved before authenticating
    const { data: items } = await supabase
      .from('order_items')
      .select('id, intake_status, card_name, quantity')
      .eq('order_id', orderId)

    const unverifiedItems = (items || []).filter(
      i => i.intake_status !== 'verified' && i.intake_status !== 'resolved'
    )

    if (unverifiedItems.length > 0) {
      const names = unverifiedItems.map(i => i.card_name).join(', ')
      return NextResponse.json({
        error: `Cannot authenticate: ${unverifiedItems.length} item(s) not yet verified — ${names}`,
      }, { status: 400 })
    }

    update.authenticated_at = now

    // Raffle entries — fire-and-forget on authentication. Safe to call
    // before the update completes since the helper is idempotent (won't
    // double-insert if the order already has entries from a prior
    // partial run). See lib/raffle.ts.
    await recordOrderRaffleEntries({
      orderId,
      buyerId: order.buyer_id,
      sellerId: order.seller_id,
      items: (items || []).map(i => ({ id: i.id, quantity: i.quantity })),
    })

    // Credit seller balance now that card is authenticated.
    //
    // Fee math has two eras:
    //   - Legacy orders (pre-migration 20260538): only platform_fee was
    //     stored, and it represented just the marketplace % — the $5
    //     shipping label fee was subtracted separately here.
    //   - Tier-aware orders (post-20260538): seller_fee (the $5 ship fee
    //     for 'ship' fulfillment, $0 otherwise), marketplace_fee, and
    //     processing_fee are all stored explicitly. platform_fee already
    //     equals seller_fee + marketplace_fee. Subtracting another $5
    //     would double-charge; not subtracting processing_fee would have
    //     the seller pocket Stripe's 3% cut.
    //
    // seller_tier_at_sale is the discriminator — it's NULL for legacy
    // orders and set for every new order.
    const { data: sellerProfile } = await supabase
      .from('profiles')
      .select('total_sales, balance')
      .eq('id', order.seller_id)
      .single()

    if (sellerProfile) {
      const isLegacy = order.seller_tier_at_sale == null
      const sellerCredit = isLegacy
        ? Number(order.total) - Number(order.platform_fee) - 5
        : Number(order.total)
            - Number(order.platform_fee || 0)
            - Number(order.processing_fee || 0)
      await supabase
        .from('profiles')
        .update({
          total_sales: (sellerProfile.total_sales || 0) + 1,
          balance: Number(sellerProfile.balance || 0) + sellerCredit,
        })
        .eq('id', order.seller_id)

      await adminSupabase.from('credit_transactions').insert({
        user_id: order.seller_id,
        amount: sellerCredit,
        type: 'sale_earned',
        order_id: orderId,
        description: isLegacy
          ? 'Sale credited on authentication (net of shipping + platform fee)'
          : 'Sale credited on authentication (net of platform fee + processing)',
      })
    }
  } else if (status === 'shipped_to_buyer') {
    // Only auto-generate the outbound label if the admin hasn't already
    // generated one manually from the admin order detail page. Keeps the
    // single-button "Ship to Buyer" flow working while letting power users
    // do the label first when they need a specific service level.
    if (!order.outbound_label_url && order.shipping_address) {
      try {
        const buyerAddr = order.shipping_address as { name: string; line1: string; line2?: string; city: string; state: string; zip: string; country: string }
        const label = await createOutboundLabel({
          name: buyerAddr.name,
          street1: buyerAddr.line1,
          street2: buyerAddr.line2 || undefined,
          city: buyerAddr.city,
          state: buyerAddr.state,
          zip: buyerAddr.zip,
          country: buyerAddr.country || 'US',
        })
        update.tracking_number = label.trackingNumber
        update.tracking_carrier = label.carrier
        update.outbound_label_url = label.labelUrl
        update.outbound_label_cost = label.cost
      } catch (err) {
        // Hold the status flip — without a tracking number the buyer
        // would get the "your card has shipped!" email with no way to
        // track it AND nobody would know the auto-label silently
        // failed. Force the admin to print manually via the order
        // detail page and retry, or fix the address.
        const msg = err instanceof Error ? err.message : 'unknown error'
        console.error('Outbound label generation failed:', err)
        notifyLabelFailure({ orderId, errorMessage: msg, side: 'outbound' })
        return NextResponse.json({
          error: `Couldn't generate outbound shipping label: ${msg}. Print the label manually from this page (the button is in the "Outbound" card), then retry "Mark Shipped to Buyer".`,
        }, { status: 502 })
      }
    }
    update.shipped_to_buyer_at = now
  }

  // Append admin notes
  if (notes) {
    const timestamp = new Date().toLocaleString('en-US')
    const existingNotes = order.admin_notes || ''
    update.admin_notes = existingNotes
      ? `${existingNotes}\n---\n[${timestamp}] ${notes}`
      : `[${timestamp}] ${notes}`
  }

  const { error: updateError } = await supabase
    .from('orders')
    .update(update)
    .eq('id', orderId)

  if (updateError) {
    return NextResponse.json({ error: 'Failed to update order' }, { status: 500 })
  }

  // Send email notifications. Each branch is wrapped independently so a
  // failed seller email doesn't suppress the buyer email (and vice
  // versa) — without per-branch try/catch a single Resend hiccup would
  // silently swallow the rest of the lifecycle notifications.
  if (status === 'received' || status === 'authenticated') {
    // Notify seller (same as before)
    try {
      const sellerAuth = await adminSupabase.auth.admin.getUserById(order.seller_id)
      const { data: sellerProfileData } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', order.seller_id)
        .single()

      const sellerEmail = sellerAuth?.data?.user?.email
      if (sellerEmail) {
        await sendSellerStatusUpdateEmail({
          sellerEmail,
          sellerName: sellerProfileData?.display_name || '',
          orderId,
          status,
        })
      }
    } catch (emailErr) {
      console.error('Failed to send seller status update email:', emailErr)
    }

    // Notify buyer too — closes the silence gap between "seller shipped"
    // and "shipped to you" that used to leave buyers in the dark for the
    // 1–2 day verification window.
    try {
      const buyerAuth = await adminSupabase.auth.admin.getUserById(order.buyer_id)
      const { data: buyerProfileData } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', order.buyer_id)
        .single()

      const buyerEmail = buyerAuth?.data?.user?.email
      if (buyerEmail) {
        const args = {
          buyerEmail,
          buyerName: buyerProfileData?.display_name || '',
          orderId,
        }
        if (status === 'received') {
          await sendBuyerReceivedEmail(args)
        } else {
          await sendBuyerAuthenticatedEmail(args)
        }
      }
    } catch (emailErr) {
      console.error(`Failed to send buyer ${status} email:`, emailErr)
    }
  }

  if (status === 'shipped_to_buyer') {
    try {
      const buyerAuth = await adminSupabase.auth.admin.getUserById(order.buyer_id)
      const { data: buyerProfileData } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', order.buyer_id)
        .single()

      const buyerEmail = buyerAuth?.data?.user?.email
      if (buyerEmail) {
        await sendBuyerShippedToBuyerEmail({
          buyerEmail,
          buyerName: buyerProfileData?.display_name || '',
          orderId,
          trackingNumber: (update.tracking_number as string) || null,
          trackingCarrier: (update.tracking_carrier as string) || null,
        })
      }
    } catch (emailErr) {
      console.error('Failed to send buyer shipped email:', emailErr)
    }
  }

  return NextResponse.json({ success: true, status })
}
