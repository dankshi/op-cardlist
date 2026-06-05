import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import QRCode from 'qrcode'

/** Printable HTML rendering of every Product QR label for an order.
 *
 *  This is the *printer-agnostic* path. The team's Zebra ZD-series
 *  printers take raw ZPL over BrowserPrint (fast path, see
 *  /api/admin/intake/print-label). But that protocol is Zebra-ZPL-
 *  specific — printers like the ZSB DP12 (and any inkjet/laser/
 *  AirPrint device) don't speak it. This endpoint renders the same
 *  labels as HTML with the QR as an <img> so they print through the
 *  normal OS print dialog / AirPrint / the ZSB app on ANY printer.
 *
 *  Each QR encodes the item's product_id — identical payload to the ZPL
 *  label (the ZPL `^FDMA,<product_id>` decodes to just `<product_id>`),
 *  so a scan on /admin/pack resolves the same whether the sticker was
 *  printed via ZPL or this HTML path.
 *
 *  Auto-fires window.print() on load (gated by ?noprint=1). Labels
 *  flow down the page as 1.25"×1.25" square blocks with dashed cut
 *  guides so they work on both a 1.25"×1.25" label roll (one per feed)
 *  and a sheet of letter paper (cut them out).
 *
 *  Admin-only. */
export async function GET(
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

  // Optional ?itemId= narrows to a single label (single-item reprint).
  const itemIdFilter = new URL(request.url).searchParams.get('itemId')

  let itemsQuery = supabase
    .from('order_items')
    .select('id, product_id, quantity')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })
  if (itemIdFilter) {
    itemsQuery = itemsQuery.eq('id', itemIdFilter)
  }
  const { data: items } = await itemsQuery

  if (!items || items.length === 0) {
    return new NextResponse('<p style="font-family:sans-serif;padding:40px">No items on this order.</p>', {
      headers: { 'Content-Type': 'text/html' },
    })
  }

  const shortId = orderId.slice(0, 8).toUpperCase()

  // One label block per item, sized 1.25"×1.25" square to match the ZPL
  // label. QR encodes product_id (same payload the scanner resolves at
  // pack-out); product_id is printed below for ops to read/type.
  const labelBlocks = await Promise.all(
    items.map(async (item) => {
      const qrDataUrl = await QRCode.toDataURL(item.product_id, {
        width: 220,
        margin: 1,
        errorCorrectionLevel: 'M',
      })
      return `
        <div class="label">
          <img class="qr" src="${qrDataUrl}" alt="QR" />
          <div class="pid">${escapeHtml(item.product_id || '')}</div>
        </div>
      `
    })
  )

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>QR Labels — Order ${shortId}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    /* Monospace throughout for a clean, technical label look. */
    body {
      font-family: ui-monospace, 'SF Mono', 'Cascadia Mono', 'Roboto Mono', Menlo, Consolas, 'Courier New', monospace;
      padding: 24px; color: #18181b; background: #fafafa;
    }

    .toolbar { margin-bottom: 20px; display: flex; gap: 8px; align-items: center; }
    .toolbar button {
      padding: 8px 18px; border-radius: 8px; border: none; cursor: pointer;
      font-family: inherit; font-size: 13px; font-weight: 600;
    }
    .toolbar .print { background: #4f46e5; color: #fff; }
    .toolbar .close { background: #fff; color: #71717a; border: 1px solid #e4e4e7; }
    .toolbar .hint { font-size: 12px; color: #a1a1aa; margin-left: 4px; }

    .label {
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
      width: 1.25in; height: 1.25in;
      border: 1px dashed #d4d4d8; border-radius: 6px;
      padding: 6px; margin-bottom: 10px; background: #fff;
      page-break-inside: avoid;
    }
    /* pixelated keeps the QR crisp (no blurry resampling) so it scans cleanly. */
    .label .qr { width: 0.82in; height: 0.82in; flex-shrink: 0; image-rendering: pixelated; }
    .label .pid {
      font-size: 13px; font-weight: 700; color: #18181b;
      letter-spacing: 0.1em; text-transform: uppercase;
    }

    @media print {
      body { padding: 0; background: #fff; }
      .no-print { display: none !important; }
      .label { border: 1px dashed #cbd5e1; background: #fff; }
      /* Tighter margins for label rolls. The operator picks the
         paper size in the print dialog (1.25"×1.25" roll, or Letter). */
      @page { margin: 0.1in; }
    }
  </style>
</head>
<body>
  <div class="toolbar no-print">
    <button class="print" onclick="window.print()">Print ${items.length} label${items.length === 1 ? '' : 's'}</button>
    <button class="close" onclick="window.close()">Close</button>
    <span class="hint">Pick your printer + a 1.25&quot;×1.25&quot; label size (or Letter to cut) in the print dialog.</span>
  </div>

  ${labelBlocks.join('\n')}

  <script>
    // Auto-print on load so the operator's flow stays tight. Disable
    // with ?noprint=1 for preview/debug.
    if (!new URLSearchParams(location.search).has('noprint')) {
      window.addEventListener('load', () => setTimeout(() => window.print(), 250))
    }
  </script>
</body>
</html>`

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
