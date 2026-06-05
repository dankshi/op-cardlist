import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

/** Resolves a scanned Product QR (the item's product_id per
 *  intake/print-label/route.ts) into a pack-out preview. Single
 *  round-trip so the screen renders the full preview before the
 *  operator commits. Returns structured reject reasons when the
 *  order can't be packed so the UI can render the right hint
 *  (fixup URL, status, etc.). See docs/packing-flow.md.
 *
 *  Admin-only. Cheapest rejections first (DB miss → status →
 *  address) so a misfired scan returns fast. */

// 9-char Crockford Base32 (no I/L/O/U) — see migration 20260606.
const PRODUCT_ID_RE = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{9}$/

interface ShippingAddressShape {
  name?: string
  line1?: string
  line2?: string
  city?: string
  state?: string
  zip?: string
  country?: string
  phone?: string
}

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

  const body = await request.json().catch(() => null)
  // Crockford Base32 is case-insensitive; normalize to the uppercase form
  // we store/print so a lowercased scan still resolves.
  const rawQr = typeof body?.qr === 'string' ? body.qr.trim().toUpperCase() : ''

  if (!rawQr) {
    return NextResponse.json({ error: 'qr is required' }, { status: 400 })
  }

  // Triage labels share the print pipeline but encode a different
  // payload — the 'T-…' triage_code (or legacy 'TRIAGE:<id>'). Refuse
  // those explicitly so the operator gets a clear "wrong label type"
  // hint rather than a generic not-found. ('T-' can't be a product_id —
  // the dash isn't in the Crockford alphabet.)
  if (rawQr.startsWith('T-') || rawQr.startsWith('TRIAGE:')) {
    return NextResponse.json({
      ok: false,
      reason: 'wrong_label',
      detail: 'This is a triage label, not a product label. Use the Intake screen for triage packages.',
    })
  }

  if (!PRODUCT_ID_RE.test(rawQr)) {
    return NextResponse.json({
      ok: false,
      reason: 'malformed',
      detail: 'QR contents did not decode to a valid product ID.',
    })
  }

  const admin = getSupabaseAdmin()

  // Fetch the item + its order in one round trip. The embedded
  // order shape is the source of truth for ship-readiness.
  const { data: itemRow } = await admin
    .from('order_items')
    .select(`
      id,
      product_id,
      order_id,
      card_id,
      card_name,
      condition,
      quantity,
      snapshot_photo_url,
      order:orders!inner(
        id,
        status,
        buyer_id,
        shipping_address,
        shipping_cost,
        outbound_label_url,
        tracking_number,
        tracking_carrier,
        shipped_to_buyer_at
      )
    `)
    .eq('product_id', rawQr)
    .maybeSingle()

  if (!itemRow) {
    return NextResponse.json({
      ok: false,
      reason: 'not_found',
      detail: 'No order item matches that QR. Was the label printed for a different system?',
    })
  }

  // Supabase FK-embed shape: array-or-object depending on detection.
  const order = Array.isArray(itemRow.order) ? itemRow.order[0] : itemRow.order
  if (!order) {
    return NextResponse.json({
      ok: false,
      reason: 'not_found',
      detail: 'Item found but parent order is missing.',
    })
  }

  // Status gating — pack-out is only valid from 'authenticated'.
  // Each reject branch returns a clear `fixup_url` so the UI can
  // route the operator to the right next screen without making
  // them go hunt.
  if (order.status === 'shipped_to_buyer' || order.status === 'delivered') {
    return NextResponse.json({
      ok: false,
      reason: 'already_shipped',
      order_id: order.id,
      detail: `This order was already shipped${order.shipped_to_buyer_at ? ` on ${new Date(order.shipped_to_buyer_at).toLocaleDateString()}` : ''}.`,
      existing_label_url: order.outbound_label_url || undefined,
      tracking_number: order.tracking_number || undefined,
      tracking_carrier: order.tracking_carrier || undefined,
      fixup_url: `/admin/orders/${order.id}`,
    })
  }

  if (order.status === 'exception_review') {
    return NextResponse.json({
      ok: false,
      reason: 'exception_review',
      order_id: order.id,
      detail: 'This order has at least one flagged item that needs resolution before it can ship.',
      fixup_url: `/admin/authenticate/${order.id}`,
    })
  }

  if (order.status === 'cancelled' || order.status === 'refunded') {
    return NextResponse.json({
      ok: false,
      reason: 'cancelled',
      order_id: order.id,
      detail: `Order is ${order.status} and cannot ship.`,
      fixup_url: `/admin/orders/${order.id}`,
    })
  }

  if (order.status !== 'authenticated') {
    return NextResponse.json({
      ok: false,
      reason: 'not_authenticated',
      order_id: order.id,
      detail: `Order is in '${order.status}'. Finish authentication first.`,
      fixup_url: `/admin/authenticate/${order.id}`,
    })
  }

  // Address gating — USPS rejects without recipient phone (we
  // surface this in pack rather than letting it bubble up as
  // Shippo's misleading "Seller info missing" error).
  const addr = (order.shipping_address || {}) as ShippingAddressShape
  if (!addr.phone) {
    return NextResponse.json({
      ok: false,
      reason: 'missing_phone',
      order_id: order.id,
      detail: 'Buyer phone is missing on the shipping address. Add one before printing a label.',
      fixup_url: `/admin/orders/${order.id}`,
    })
  }

  // Qualifies — fetch the rest of the items + buyer profile so the
  // preview can render the full pack.
  const [{ data: allItems }, { data: buyerProfile }] = await Promise.all([
    admin
      .from('order_items')
      .select('id, card_id, card_name, condition, quantity, snapshot_photo_url')
      .eq('order_id', order.id),
    admin
      .from('profiles')
      .select('display_name')
      .eq('id', order.buyer_id)
      .single(),
  ])

  // Card thumbnails for items that don't carry a snapshot photo.
  const cardIds = [...new Set((allItems || []).filter(i => !i.snapshot_photo_url).map(i => i.card_id))]
  const cardImages: Record<string, string> = {}
  if (cardIds.length > 0) {
    try {
      const proto = request.headers.get('x-forwarded-proto') || 'http'
      const host = request.headers.get('host')
      const r = await fetch(`${proto}://${host}/api/cards?basic=1&ids=${encodeURIComponent(cardIds.join(','))}`)
      const d = await r.json()
      for (const c of d.cards || []) {
        if (c.imageUrl) cardImages[c.id] = c.imageUrl
      }
    } catch { /* thumbnails are decorative */ }
  }

  return NextResponse.json({
    ok: true,
    order: {
      id: order.id,
      buyer_name: buyerProfile?.display_name || 'Buyer',
      items: (allItems || []).map(i => ({
        id: i.id,
        card_name: i.card_name,
        condition: i.condition,
        quantity: i.quantity,
        image_url: i.snapshot_photo_url || cardImages[i.card_id] || null,
      })),
      shipping_address: addr,
      shipping_cost: Number(order.shipping_cost || 0),
      item_count: (allItems || []).reduce((sum, i) => sum + i.quantity, 0),
    },
    // Surface which item the QR resolved to so the UI can highlight
    // it in the preview. Useful when the order has multiple cards
    // and the operator wants to confirm they grabbed the right one.
    scanned_item_id: itemRow.id,
  })
}
