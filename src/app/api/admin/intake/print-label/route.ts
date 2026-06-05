import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

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

  const { type, data } = await request.json()

  if (!type || !['product', 'triage_no_order', 'triage_user_id'].includes(type)) {
    return NextResponse.json({ error: 'Invalid label type' }, { status: 400 })
  }

  let zpl: string

  if (type === 'product') {
    // Product QR label — 1.25" x 1.25" square. QR encodes the item's
    // product_id (the short, unique label code); the same product_id is
    // printed beneath it for ops to read/type. Both the scan path
    // (pack/lookup) and manual search resolve to order_items.product_id.
    const { orderItemId } = data || {}
    if (!orderItemId) {
      return NextResponse.json({ error: 'orderItemId is required for product labels' }, { status: 400 })
    }

    // product_id is the source of truth in the DB — look it up by the
    // item id (admin client; RLS on order_items is buyer/seller-scoped).
    const { data: itemRow } = await getSupabaseAdmin()
      .from('order_items')
      .select('product_id')
      .eq('id', orderItemId)
      .maybeSingle()

    const productId = itemRow?.product_id
    if (!productId) {
      return NextResponse.json({ error: 'No product_id found for that order item' }, { status: 404 })
    }

    // 1.25" x 1.25" square at 203 DPI (254 x 254 dots). QR centered near
    // the top (mag 6 → a 9-char code stays a 21-module v1 QR ≈ 126 dots),
    // product_id centered below in a readable monospace-ish scalable font.
    zpl = [
      '^XA',
      '^PW254',
      '^LL254',
      `^FO64,20^BQN,2,6^FDMA,${escapeZpl(productId)}^FS`,
      `^FO0,170^A0N,36,36^FB254,1,0,C^FD${escapeZpl(productId)}^FS`,
      '^XZ',
    ].join('\n')
  } else if (type === 'triage_no_order') {
    // Triage label — no order, just a triage package ID
    const { triagePackageId, trackingNumber } = data || {}
    if (!triagePackageId) {
      return NextResponse.json({ error: 'triagePackageId is required' }, { status: 400 })
    }

    const qrData = `TRIAGE:${triagePackageId}`
    const trackingDisplay = trackingNumber ? trackingNumber.slice(-8) : 'N/A'

    zpl = [
      '^XA',
      '^CF0,24',
      `^FO20,20^BQN,2,4^FDMA,${qrData}^FS`,
      `^FO180,25^A0N,28,28^FDTRIAGE^FS`,
      `^FO180,55^A0N,20,20^FDNo Order^FS`,
      `^FO180,80^A0N,14,14^FDTrk: ${escapeZpl(trackingDisplay)}^FS`,
      '^XZ',
    ].join('\n')
  } else {
    // Triage label — user ID known
    const { triagePackageId, sellerName, trackingNumber } = data || {}
    if (!triagePackageId) {
      return NextResponse.json({ error: 'triagePackageId is required' }, { status: 400 })
    }

    const qrData = `TRIAGE:${triagePackageId}`
    const sellerDisplay = (sellerName || 'Unknown Seller').slice(0, 20)

    zpl = [
      '^XA',
      '^CF0,24',
      `^FO20,20^BQN,2,4^FDMA,${qrData}^FS`,
      `^FO180,25^A0N,28,28^FDTRIAGE^FS`,
      `^FO180,55^A0N,20,20^FDSeller: ${escapeZpl(sellerDisplay)}^FS`,
      `^FO180,80^A0N,14,14^FDTrk: ${escapeZpl((trackingNumber || 'N/A').slice(-8))}^FS`,
      '^XZ',
    ].join('\n')
  }

  return NextResponse.json({ zpl, label_type: type })
}

function escapeZpl(str: string): string {
  // Remove characters that could break ZPL commands
  return str.replace(/[\^~]/g, '').replace(/[^\x20-\x7E]/g, '')
}
