import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import QRCode from 'qrcode'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fetch order with items
  const { data: order } = await supabase
    .from('orders')
    .select('*, buyer:profiles!orders_buyer_id_fkey(display_name), seller:profiles!orders_seller_id_fkey(display_name, shipping_street1, shipping_city, shipping_state, shipping_zip)')
    .eq('id', orderId)
    .single()

  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  // Only order seller or admin can access
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (order.seller_id !== user.id && !profile?.is_admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: items } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })

  // Generate QR code as data URL
  const qrDataUrl = await QRCode.toDataURL(orderId, {
    width: 200,
    margin: 2,
    errorCorrectionLevel: 'M',
  })

  const seller = order.seller as { display_name: string; shipping_street1: string; shipping_city: string; shipping_state: string; shipping_zip: string }
  const shortId = orderId.slice(0, 8).toUpperCase()

  const itemRows = (items || []).map((item, index) => `
    <tr>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">#${index + 1}</td>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${item.card_name}</td>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.quantity}</td>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${item.condition === 'near_mint' ? 'Near Mint' : item.condition}</td>
    </tr>
  `).join('')

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Packing Slip - Order ${shortId}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; padding: 40px; max-width: 800px; margin: 0 auto; }
    @media print {
      body { padding: 20px; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="margin-bottom: 20px; text-align: right;">
    <button onclick="window.print()" style="padding: 8px 20px; background: #f97316; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;">
      Print Packing Slip
    </button>
  </div>

  <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 30px; border-bottom: 2px solid #1a1a1a; padding-bottom: 20px;">
    <div>
      <h1 style="font-size: 24px; margin-bottom: 4px;">PACKING SLIP</h1>
      <p style="font-size: 14px; color: #666;">Order #${shortId}</p>
      <p style="font-size: 12px; color: #999; margin-top: 4px;">${new Date(order.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
    </div>
    <div style="text-align: center;">
      <img src="${qrDataUrl}" alt="QR Code" style="width: 120px; height: 120px;" />
      <p style="font-size: 10px; color: #666; margin-top: 4px;">Scan to intake</p>
    </div>
  </div>

  <div style="display: flex; justify-content: space-between; margin-bottom: 30px;">
    <div>
      <h3 style="font-size: 12px; text-transform: uppercase; color: #999; margin-bottom: 6px;">From (Seller)</h3>
      <p style="font-size: 14px; font-weight: 600;">${seller.display_name || 'Seller'}</p>
      ${seller.shipping_street1 ? `<p style="font-size: 13px; color: #444;">${seller.shipping_street1}</p>` : ''}
      ${seller.shipping_city ? `<p style="font-size: 13px; color: #444;">${seller.shipping_city}, ${seller.shipping_state} ${seller.shipping_zip}</p>` : ''}
    </div>
    <div>
      <h3 style="font-size: 12px; text-transform: uppercase; color: #999; margin-bottom: 6px;">Buyer</h3>
      <p style="font-size: 14px; font-weight: 600;">${(order.buyer as { display_name: string }).display_name || 'Buyer'}</p>
    </div>
  </div>

  <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
    <thead>
      <tr style="background: #f4f4f5;">
        <th style="padding: 10px 8px; text-align: left; font-size: 12px; text-transform: uppercase; color: #666;">#</th>
        <th style="padding: 10px 8px; text-align: left; font-size: 12px; text-transform: uppercase; color: #666;">Card</th>
        <th style="padding: 10px 8px; text-align: center; font-size: 12px; text-transform: uppercase; color: #666;">Qty</th>
        <th style="padding: 10px 8px; text-align: left; font-size: 12px; text-transform: uppercase; color: #666;">Condition</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>

  <div style="border: 2px dashed #e5e7eb; padding: 16px; border-radius: 8px; text-align: center;">
    <p style="font-size: 12px; color: #999; text-transform: uppercase; margin-bottom: 4px;">Platform Use Only</p>
    <p style="font-size: 11px; color: #bbb;">Order ID: ${orderId}</p>
    <p style="font-size: 11px; color: #bbb;">Items: ${(items || []).length} | Total: $${Number(order.total).toFixed(2)}</p>
  </div>
</body>
</html>`

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html' },
  })
}
