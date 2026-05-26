import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/** Renders a buyer-facing packing slip for an order in
 *  shipped_to_buyer (or beyond). This is the slip that goes IN
 *  THE BOX shipped from Nomi to the buyer — different from the
 *  inbound slip at /api/orders/[id]/packing-slip which the seller
 *  uses to ship into our warehouse.
 *
 *  Returns HTML with an auto-print hook so the pack-out flow can
 *  open this in a new tab and the browser fires the system print
 *  dialog immediately. The "no-print" sections collapse on print,
 *  leaving a clean 8.5"x11" portrait slip with our brand, the
 *  buyer's items, and the post-purchase callouts (return policy +
 *  authentication assurance).
 *
 *  Admin-only. */
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

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: order } = await supabase
    .from('orders')
    .select('*, buyer:profiles!orders_buyer_id_fkey(display_name)')
    .eq('id', orderId)
    .single()
  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  const { data: items } = await supabase
    .from('order_items')
    .select('card_name, condition, quantity, unit_price, grading_company, grade')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })

  const buyer = order.buyer as { display_name: string }
  const addr = (order.shipping_address || {}) as {
    name?: string; line1?: string; line2?: string; city?: string;
    state?: string; zip?: string; country?: string
  }
  const shortId = orderId.slice(0, 8).toUpperCase()
  const shippedDate = order.shipped_to_buyer_at
    ? new Date(order.shipped_to_buyer_at)
    : new Date()

  const itemRows = (items || []).map((item: {
    card_name: string
    condition: string
    quantity: number
    unit_price: number
    grading_company: string | null
    grade: string | null
  }, index: number) => {
    const conditionLabel = item.grading_company && item.grade
      ? `${item.grading_company} ${item.grade}`
      : item.condition === 'near_mint' ? 'Near Mint (Ungraded)' : item.condition
    return `
      <tr>
        <td style="padding: 12px 8px; border-bottom: 1px solid #e5e7eb; color: #9ca3af; font-weight: 600;">#${index + 1}</td>
        <td style="padding: 12px 8px; border-bottom: 1px solid #e5e7eb;">
          <div style="font-weight: 600; color: #18181b;">${escape(item.card_name)}</div>
          <div style="font-size: 12px; color: #6b7280; margin-top: 2px;">${escape(conditionLabel)}</div>
        </td>
        <td style="padding: 12px 8px; border-bottom: 1px solid #e5e7eb; text-align: center; color: #18181b; font-weight: 600;">${item.quantity}</td>
      </tr>
    `
  }).join('')

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Packing Slip — Order ${shortId}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #18181b;
      padding: 40px;
      max-width: 800px;
      margin: 0 auto;
    }
    @media print {
      body { padding: 24px; }
      .no-print { display: none !important; }
      /* Letting the print engine size the page. Default A4/US-Letter
         portrait is fine for an 8.5"x11" slip. */
    }
  </style>
</head>
<body>
  <div class="no-print" style="margin-bottom: 24px; display: flex; justify-content: flex-end; gap: 8px;">
    <button onclick="window.print()" style="padding: 8px 20px; background: #f97316; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600;">
      Print
    </button>
    <button onclick="window.close()" style="padding: 8px 20px; background: white; color: #71717a; border: 1px solid #e4e4e7; border-radius: 8px; cursor: pointer; font-size: 14px;">
      Close
    </button>
  </div>

  <!-- Brand header. -->
  <div style="display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 20px; border-bottom: 3px solid #18181b;">
    <div>
      <div style="font-size: 28px; font-weight: 800; letter-spacing: -0.5px; color: #18181b;">nomi market</div>
      <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">The trusted TCG marketplace</div>
    </div>
    <div style="text-align: right;">
      <div style="font-size: 11px; text-transform: uppercase; color: #9ca3af; letter-spacing: 1px;">Packing Slip</div>
      <div style="font-size: 18px; font-weight: 700; color: #18181b; margin-top: 2px;">#${shortId}</div>
      <div style="font-size: 11px; color: #9ca3af; margin-top: 2px;">${shippedDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
    </div>
  </div>

  <!-- Buyer-warming hero. Buyers love this part — turns a transactional
       slip into a moment of brand. -->
  <div style="text-align: center; padding: 32px 0 24px;">
    <div style="font-size: 22px; font-weight: 700; color: #18181b;">Hey ${escape((buyer?.display_name || 'there').split(' ')[0])} 👋</div>
    <div style="font-size: 14px; color: #6b7280; margin-top: 6px; max-width: 480px; margin-left: auto; margin-right: auto; line-height: 1.5;">
      Your card${(items?.length || 0) > 1 ? 's' : ''} passed our authentication. Below is what should be in the box — give it a once-over before sleeving up.
    </div>
  </div>

  <!-- Ship-to + Order summary. Side by side. -->
  <div style="display: flex; justify-content: space-between; gap: 24px; margin-bottom: 24px;">
    <div style="flex: 1;">
      <div style="font-size: 11px; text-transform: uppercase; color: #9ca3af; letter-spacing: 1px; margin-bottom: 6px;">Ship To</div>
      <div style="font-size: 14px; font-weight: 600; color: #18181b;">${escape(addr.name || buyer?.display_name || '')}</div>
      ${addr.line1 ? `<div style="font-size: 13px; color: #4b5563; margin-top: 2px;">${escape(addr.line1)}${addr.line2 ? `, ${escape(addr.line2)}` : ''}</div>` : ''}
      ${addr.city ? `<div style="font-size: 13px; color: #4b5563;">${escape(addr.city)}, ${escape(addr.state || '')} ${escape(addr.zip || '')}</div>` : ''}
    </div>
    <div style="flex: 1; text-align: right;">
      <div style="font-size: 11px; text-transform: uppercase; color: #9ca3af; letter-spacing: 1px; margin-bottom: 6px;">Order</div>
      <div style="font-size: 13px; color: #4b5563;">Placed ${new Date(order.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
      <div style="font-size: 13px; color: #4b5563; margin-top: 2px;">${items?.length || 0} item${(items?.length || 0) === 1 ? '' : 's'}</div>
    </div>
  </div>

  <!-- Items table. -->
  <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
    <thead>
      <tr style="background: #f9fafb;">
        <th style="padding: 10px 8px; text-align: left; font-size: 11px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.5px;"></th>
        <th style="padding: 10px 8px; text-align: left; font-size: 11px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.5px;">Card</th>
        <th style="padding: 10px 8px; text-align: center; font-size: 11px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.5px;">Qty</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>

  <!-- Trust + return callouts. Why-they-should-feel-good content. -->
  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px;">
    <div style="background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 10px; padding: 16px;">
      <div style="font-size: 12px; font-weight: 700; color: #065f46; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">✓ Authenticated</div>
      <div style="font-size: 12px; color: #047857; line-height: 1.5;">
        Every card was inspected by our authenticators — condition + authenticity verified before shipping.
      </div>
    </div>
    <div style="background: #fef3c7; border: 1px solid #fde68a; border-radius: 10px; padding: 16px;">
      <div style="font-size: 12px; font-weight: 700; color: #92400e; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">14-Day Returns</div>
      <div style="font-size: 12px; color: #b45309; line-height: 1.5;">
        Not what you expected? Start a return at nomimarket.com/orders/${orderId} within 14 days for a full refund.
      </div>
    </div>
  </div>

  <!-- Footer. Order ID for support, no totals (buyer doesn't want
       to be reminded of the price every time they see this). -->
  <div style="text-align: center; padding-top: 16px; border-top: 1px solid #f3f4f6;">
    <div style="font-size: 11px; color: #9ca3af;">
      Questions? Email <a href="mailto:help@nomimarket.com" style="color: #f97316; text-decoration: none;">help@nomimarket.com</a> with order ID <span style="font-family: ui-monospace, monospace; color: #4b5563;">${shortId}</span>
    </div>
  </div>

  <script>
    // Auto-trigger print on first load. The pack-out flow opens this
    // in a new tab right after a label prints; we want the print
    // dialog up immediately so the operator's flow stays "scan, ship,
    // print slip" without a manual second click. ?autoprint=0 disables
    // for support / debugging.
    if (!new URLSearchParams(location.search).has('noprint')) {
      window.addEventListener('load', () => {
        setTimeout(() => window.print(), 200)
      })
    }
  </script>
</body>
</html>`

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

/** Minimal HTML escape — these values come from the DB but it's
 *  good hygiene to not trust them in a string template. */
function escape(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
