import { getResend } from './resend'
import type { ShippingAddress } from '@/types/database'

const FROM = process.env.RESEND_FROM_EMAIL || 'orders@nomimarket.com'
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

interface OrderEmailItem {
  card_name: string
  quantity: number
  unit_price: number
  condition: string
}

// ─── Seller: New Order ────────────────────────────────────────────

export async function sendSellerNewOrderEmail({
  sellerEmail,
  sellerName,
  orderId,
  items,
  total,
  platformFee,
  buyerName,
  shippingAddress,
}: {
  sellerEmail: string
  sellerName: string
  orderId: string
  items: OrderEmailItem[]
  total: number
  platformFee: number
  buyerName: string
  shippingAddress: ShippingAddress | null
}) {
  const itemRows = items
    .map(
      (item) =>
        `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e4e4e7;">${item.card_name}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e4e4e7;text-align:center;">${item.quantity}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e4e4e7;text-align:right;">$${(Number(item.unit_price) * item.quantity).toFixed(2)}</td>
        </tr>`
    )
    .join('')

  const addressBlock = shippingAddress
    ? `<div style="background:#f4f4f5;border-radius:8px;padding:16px;margin-top:16px;">
        <p style="margin:0 0 4px;font-weight:600;color:#18181b;">Ship to:</p>
        <p style="margin:0;color:#3f3f46;">${shippingAddress.name}</p>
        <p style="margin:0;color:#3f3f46;">${shippingAddress.line1}</p>
        ${shippingAddress.line2 ? `<p style="margin:0;color:#3f3f46;">${shippingAddress.line2}</p>` : ''}
        <p style="margin:0;color:#3f3f46;">${shippingAddress.city}, ${shippingAddress.state} ${shippingAddress.zip}</p>
      </div>`
    : ''

  const payout = (total - platformFee).toFixed(2)

  await getResend().emails.send({
    from: `nomi market <${FROM}>`,
    to: sellerEmail,
    subject: `New order! Ship it — Order #${orderId.slice(0, 8)}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;">
        <h1 style="color:#18181b;font-size:24px;margin-bottom:4px;">You have a new order!</h1>
        <p style="color:#71717a;margin-top:0;">From ${buyerName || 'a buyer'} &middot; <a href="${SITE_URL}/orders/${orderId}" style="color:#f97316;">View order</a></p>

        <table style="width:100%;border-collapse:collapse;margin-top:16px;">
          <thead>
            <tr style="background:#f4f4f5;">
              <th style="padding:8px 12px;text-align:left;font-size:13px;color:#71717a;">Card</th>
              <th style="padding:8px 12px;text-align:center;font-size:13px;color:#71717a;">Qty</th>
              <th style="padding:8px 12px;text-align:right;font-size:13px;color:#71717a;">Price</th>
            </tr>
          </thead>
          <tbody>${itemRows}</tbody>
        </table>

        <div style="margin-top:12px;text-align:right;">
          <p style="margin:0;color:#71717a;font-size:13px;">Total: $${total.toFixed(2)}</p>
          <p style="margin:0;color:#71717a;font-size:13px;">Platform fee: -$${platformFee.toFixed(2)}</p>
          <p style="margin:4px 0 0;color:#18181b;font-weight:700;">Your payout: $${payout}</p>
        </div>

        ${addressBlock}

        <div style="margin-top:24px;text-align:center;">
          <a href="${SITE_URL}/orders/${orderId}" style="display:inline-block;background:#f97316;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
            View Order &amp; Ship
          </a>
        </div>

        <p style="margin-top:32px;font-size:12px;color:#a1a1aa;text-align:center;">nomi market &middot; The Trusted TCG Marketplace</p>
      </div>
    `,
  })
}

// ─── Buyer: Order Receipt ─────────────────────────────────────────

export async function sendBuyerReceiptEmail({
  buyerEmail,
  buyerName,
  orderId,
  items,
  total,
  sellerName,
}: {
  buyerEmail: string
  buyerName: string
  orderId: string
  items: OrderEmailItem[]
  total: number
  sellerName: string
}) {
  const itemRows = items
    .map(
      (item) =>
        `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e4e4e7;">${item.card_name}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e4e4e7;text-align:center;">${item.quantity}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e4e4e7;text-align:right;">$${(Number(item.unit_price) * item.quantity).toFixed(2)}</td>
        </tr>`
    )
    .join('')

  await getResend().emails.send({
    from: `nomi market <${FROM}>`,
    to: buyerEmail,
    subject: `Order confirmed — #${orderId.slice(0, 8)}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;">
        <h1 style="color:#18181b;font-size:24px;margin-bottom:4px;">Order confirmed!</h1>
        <p style="color:#71717a;margin-top:0;">Hi ${buyerName || 'there'}, your order from ${sellerName || 'the seller'} is confirmed.</p>

        <table style="width:100%;border-collapse:collapse;margin-top:16px;">
          <thead>
            <tr style="background:#f4f4f5;">
              <th style="padding:8px 12px;text-align:left;font-size:13px;color:#71717a;">Card</th>
              <th style="padding:8px 12px;text-align:center;font-size:13px;color:#71717a;">Qty</th>
              <th style="padding:8px 12px;text-align:right;font-size:13px;color:#71717a;">Price</th>
            </tr>
          </thead>
          <tbody>${itemRows}</tbody>
        </table>

        <div style="margin-top:12px;text-align:right;">
          <p style="margin:4px 0 0;color:#18181b;font-weight:700;font-size:16px;">Total: $${total.toFixed(2)}</p>
        </div>

        <p style="color:#71717a;margin-top:16px;">The seller has been notified and will ship your order soon. We&rsquo;ll email you when it ships.</p>

        <div style="margin-top:24px;text-align:center;">
          <a href="${SITE_URL}/orders/${orderId}" style="display:inline-block;background:#f97316;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
            Track Your Order
          </a>
        </div>

        <p style="margin-top:32px;font-size:12px;color:#a1a1aa;text-align:center;">nomi market &middot; The Trusted TCG Marketplace</p>
      </div>
    `,
  })
}

// ─── Buyer: Order Shipped ─────────────────────────────────────────

export async function sendBuyerShippedEmail({
  buyerEmail,
  buyerName,
  orderId,
  sellerName,
  trackingNumber,
  trackingCarrier,
}: {
  buyerEmail: string
  buyerName: string
  orderId: string
  sellerName: string
  trackingNumber?: string | null
  trackingCarrier?: string | null
}) {
  const trackingBlock =
    trackingNumber
      ? `<div style="background:#f4f4f5;border-radius:8px;padding:16px;margin-top:16px;">
          <p style="margin:0 0 4px;font-weight:600;color:#18181b;">Tracking info</p>
          ${trackingCarrier ? `<p style="margin:0;color:#3f3f46;">Carrier: ${trackingCarrier}</p>` : ''}
          <p style="margin:0;color:#3f3f46;">Tracking #: ${trackingNumber}</p>
        </div>`
      : ''

  await getResend().emails.send({
    from: `nomi market <${FROM}>`,
    to: buyerEmail,
    subject: `Your order has shipped! — #${orderId.slice(0, 8)}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;">
        <h1 style="color:#18181b;font-size:24px;margin-bottom:4px;">Your order has shipped!</h1>
        <p style="color:#71717a;margin-top:0;">Hi ${buyerName || 'there'}, ${sellerName || 'the seller'} has shipped your order.</p>

        ${trackingBlock}

        <div style="margin-top:24px;text-align:center;">
          <a href="${SITE_URL}/orders/${orderId}" style="display:inline-block;background:#f97316;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
            View Order
          </a>
        </div>

        <p style="color:#71717a;margin-top:16px;">Once you receive your cards, visit the order page to confirm delivery and leave a review.</p>

        <p style="margin-top:32px;font-size:12px;color:#a1a1aa;text-align:center;">nomi market &middot; The Trusted TCG Marketplace</p>
      </div>
    `,
  })
}
