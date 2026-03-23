import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
    // Product QR code label — encodes the order item ID
    const { orderItemId, cardName, shortOrderId } = data || {}
    if (!orderItemId) {
      return NextResponse.json({ error: 'orderItemId is required for product labels' }, { status: 400 })
    }

    const displayName = (cardName || 'Unknown Card').slice(0, 30)
    const orderId = shortOrderId || orderItemId.slice(0, 8).toUpperCase()

    // 2" x 1" label at 203 DPI (406 x 203 dots)
    zpl = [
      '^XA',
      '^CF0,24',
      // QR code on the left
      `^FO20,20^BQN,2,4^FDMA,${orderItemId}^FS`,
      // Card name on the right
      `^FO180,25^A0N,24,24^FD${escapeZpl(displayName)}^FS`,
      // Order ID below
      `^FO180,55^A0N,20,20^FDOrder: ${escapeZpl(orderId)}^FS`,
      // Item ID small at bottom
      `^FO180,80^A0N,14,14^FD${orderItemId.slice(0, 8)}^FS`,
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
