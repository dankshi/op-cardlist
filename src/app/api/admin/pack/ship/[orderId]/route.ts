import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { createOutboundLabel } from '@/lib/shippo'
import { sendBuyerShippedToBuyerEmail } from '@/lib/email'

/** Commits a pack-out: generates the outbound Shippo label as ZPL
 *  (for direct-to-Zebra dispatch), saves tracking + label data on
 *  the order, transitions to 'shipped_to_buyer', and fires the
 *  buyer's shipped email. See docs/packing-flow.md.
 *
 *  Re-validates the pre-conditions even though the lookup endpoint
 *  did — a second admin could have shipped this order between the
 *  scan preview and the click, and we'd rather 409 than double-ship.
 *
 *  Admin-only. */
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

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Label format follows the client's detected printer:
  //   - 'ZPL'  → Zebra ZD printer present, dispatch raw ZPL to BrowserPrint
  //   - 'PDF'  → no ZPL printer (ZSB DP12 / AirPrint / inkjet), open the
  //              PDF in a tab and print via the OS dialog
  // Default PDF — the universal path. The client only asks for ZPL
  // when it has actually detected a Zebra. For ZPL we still get a
  // valid label_url back (it points at the ZPL text), but the client
  // won't open it; for PDF the label_url is a real printable PDF.
  const body = await request.json().catch(() => ({}))
  const format: 'PDF' | 'ZPL' = body?.format === 'ZPL' ? 'ZPL' : 'PDF'

  const admin = getSupabaseAdmin()

  // ── Re-fetch + validate (lookup may be seconds stale) ─────────
  const { data: order } = await admin
    .from('orders')
    .select('id, status, buyer_id, shipping_address')
    .eq('id', orderId)
    .single()

  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  if (order.status !== 'authenticated') {
    return NextResponse.json({
      error: `Cannot pack: order is in '${order.status}', expected 'authenticated'. Did another admin ship it?`,
    }, { status: 409 })
  }

  const addr = order.shipping_address as {
    name: string; line1: string; line2?: string; city: string;
    state: string; zip: string; country: string; phone?: string
  } | null

  if (!addr) {
    return NextResponse.json({ error: 'Order is missing a shipping address' }, { status: 400 })
  }
  if (!addr.phone) {
    return NextResponse.json({
      error: 'Buyer phone missing — required for USPS label. Add it on the order detail page and retry.',
    }, { status: 400 })
  }

  // Buyer's email lives on auth.users, not the order.
  const buyerAuth = await admin.auth.admin.getUserById(order.buyer_id)
  const buyerEmail = buyerAuth?.data?.user?.email
  if (!buyerEmail) {
    return NextResponse.json({
      error: 'Buyer email not on file — required for USPS label.',
    }, { status: 400 })
  }

  // ── Generate the label in the format the client's printer needs.
  //    ZPL → Zebra direct dispatch; PDF → universal print dialog.
  let label: Awaited<ReturnType<typeof createOutboundLabel>>
  try {
    label = await createOutboundLabel(
      {
        name: addr.name,
        street1: addr.line1,
        street2: addr.line2 || undefined,
        city: addr.city,
        state: addr.state,
        zip: addr.zip,
        country: addr.country || 'US',
        email: buyerEmail,
        phone: addr.phone,
      },
      { format },
    )
  } catch (err) {
    console.error('Pack outbound label generation failed:', err)
    return NextResponse.json({
      error: `Couldn't generate outbound shipping label: ${err instanceof Error ? err.message : 'unknown error'}.`,
    }, { status: 502 })
  }

  // ── Commit: status flip with optimistic lock on the WHERE ─────
  // Re-checking status='authenticated' in the UPDATE means a
  // concurrent ship by another admin between our re-fetch and this
  // UPDATE causes 0 rows matched and we 409 the operator cleanly.
  const now = new Date().toISOString()
  const { data: updated, error: updateErr } = await admin
    .from('orders')
    .update({
      status: 'shipped_to_buyer',
      tracking_number: label.trackingNumber,
      tracking_carrier: label.carrier,
      outbound_label_url: label.labelUrl,
      outbound_label_cost: label.cost,
      shipped_to_buyer_at: now,
    })
    .eq('id', orderId)
    .eq('status', 'authenticated')
    .select('id')

  if (updateErr) {
    return NextResponse.json({
      error: `Failed to update order: ${updateErr.message}`,
    }, { status: 500 })
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json({
      error: 'Another admin shipped this order seconds ago. Refresh and re-scan.',
    }, { status: 409 })
  }

  // ── Buyer email — independent try/catch so a Resend hiccup
  //    doesn't roll back a real shipment.
  try {
    await sendBuyerShippedToBuyerEmail({
      buyerEmail,
      buyerName: '',
      orderId,
      trackingNumber: label.trackingNumber,
      trackingCarrier: label.carrier,
    })
  } catch (emailErr) {
    console.error('[pack/ship] buyer email failed', emailErr)
  }

  // ── Audit row in the existing intake activity log.
  await admin.from('intake_activity_log').insert({
    order_id: orderId,
    action: 'packed_out',
    details: {
      tracking_number: label.trackingNumber,
      carrier: label.carrier,
      cost: label.cost,
      label_url: label.labelUrl,
    },
    performed_by: user.id,
  })

  return NextResponse.json({
    ok: true,
    order_id: orderId,
    label_url: label.labelUrl,
    zpl: label.zpl,                   // null if Shippo ZPL fetch failed; client falls back to label_url
    tracking_number: label.trackingNumber,
    carrier: label.carrier,
    cost: label.cost,
  })
}
