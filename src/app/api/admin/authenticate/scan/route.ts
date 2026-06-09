import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

/** Resolves a scanned Product QR (the item's product_id per
 *  intake/print-label/route.ts) OR a raw order ID into an order that's
 *  ready to authenticate. Mirrors /api/admin/pack/lookup's resolution
 *  and status-gating shape, but the valid target status here is
 *  'received' or 'exception_review' (authentication is only available
 *  in those states — see /admin/authenticate/[orderId]).
 *
 *  Admin-only. Returns { ok: true, order_id, ... } on success, or
 *  { ok: false, reason, detail, fixup_url? } so the scan UI can render
 *  a precise hint instead of a generic miss. */

// 9-char Crockford Base32 (no I/L/O/U) — product_id, migration 20260606.
const PRODUCT_ID_RE = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{9}$/
// Full order UUID, or a hex prefix (≥8 chars) that contains a hex letter
// or dash — a purely-numeric string is a tracking number, not an order ID.
// Matches the order-ID detection in /admin/intake handleScan.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const AUTHENTICATABLE = new Set(['received', 'exception_review'])

interface OrderRow {
  id: string
  status: string
  seller_id: string
  seller?: { display_name?: string | null } | { display_name?: string | null }[] | null
}

function sellerName(order: OrderRow): string {
  const s = Array.isArray(order.seller) ? order.seller[0] : order.seller
  return s?.display_name || 'Unknown Seller'
}

/** Status-gate a resolved order and shape the JSON response. */
function gate(order: OrderRow, itemCount: number) {
  if (!AUTHENTICATABLE.has(order.status)) {
    return NextResponse.json({
      ok: false,
      reason: 'wrong_status',
      order_id: order.id,
      status: order.status,
      detail: `Order is '${order.status}'. Authentication is only available while an order is 'received' or in 'exception_review'.`,
      fixup_url: `/admin/orders/${order.id}`,
    })
  }
  return NextResponse.json({
    ok: true,
    order_id: order.id,
    status: order.status,
    short_id: order.id.slice(0, 8).toUpperCase(),
    seller_name: sellerName(order),
    item_count: itemCount,
  })
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
  // we store/print so a lowercased scan still resolves. Order UUIDs are
  // lowercase hex, so re-lowercase when matching those below.
  const raw = typeof body?.qr === 'string' ? body.qr.trim() : ''

  if (!raw) {
    return NextResponse.json({ error: 'qr is required' }, { status: 400 })
  }

  // Triage labels share the print pipeline but encode a 'T-…' triage_code.
  // Those belong on the Intake screen — reject explicitly so the operator
  // gets a clear "wrong label type" hint rather than a generic not-found.
  if (raw.toUpperCase().startsWith('T-') || raw.startsWith('TRIAGE:')) {
    return NextResponse.json({
      ok: false,
      reason: 'wrong_label',
      detail: 'This is a triage label, not a product or order label. Use the Intake screen for triage packages.',
    })
  }

  const admin = getSupabaseAdmin()
  const upper = raw.toUpperCase()

  // 1. Product QR → resolve the item to its parent order.
  if (PRODUCT_ID_RE.test(upper)) {
    const { data: itemRow } = await admin
      .from('order_items')
      .select('id, order_id, order:orders!inner(id, status, seller_id, seller:profiles!orders_seller_id_fkey(display_name))')
      .eq('product_id', upper)
      .maybeSingle()

    if (!itemRow) {
      return NextResponse.json({
        ok: false,
        reason: 'not_found',
        detail: 'No order item matches that QR. Was the label printed for a different system?',
      })
    }

    const order = (Array.isArray(itemRow.order) ? itemRow.order[0] : itemRow.order) as OrderRow | undefined
    if (!order) {
      return NextResponse.json({ ok: false, reason: 'not_found', detail: 'Item found but parent order is missing.' })
    }

    const { count } = await admin
      .from('order_items')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', order.id)

    return gate(order, count ?? 0)
  }

  // 2. Order ID — full UUID or a hex prefix (must contain a hex letter or
  //    dash; a purely-numeric string is a tracking number, not an order).
  const looksLikeOrderId =
    UUID_RE.test(raw) ||
    (raw.length >= 8 && raw.length <= 36 && /^[0-9a-f-]+$/i.test(raw) && /[a-f-]/i.test(raw))

  if (looksLikeOrderId) {
    const id = raw.toLowerCase()
    let order: OrderRow | undefined

    if (UUID_RE.test(raw)) {
      const { data } = await admin
        .from('orders')
        .select('id, status, seller_id, seller:profiles!orders_seller_id_fkey(display_name)')
        .eq('id', id)
        .maybeSingle()
      order = data as OrderRow | undefined
    } else {
      // Prefix scan: fetch recent orders and match the prefix client-side
      // (PostgREST can't ilike a UUID column). Matches scan/route.ts.
      const { data: recent } = await admin
        .from('orders')
        .select('id, status, seller_id, seller:profiles!orders_seller_id_fkey(display_name)')
        .order('created_at', { ascending: false })
        .limit(200)
      order = (recent || []).find(o => (o.id as string).startsWith(id)) as OrderRow | undefined
    }

    if (!order) {
      return NextResponse.json({ ok: false, reason: 'not_found', detail: 'No order matches that ID.' })
    }

    const { count } = await admin
      .from('order_items')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', order.id)

    return gate(order, count ?? 0)
  }

  return NextResponse.json({
    ok: false,
    reason: 'malformed',
    detail: 'Scan did not look like a product QR or an order ID.',
  })
}
