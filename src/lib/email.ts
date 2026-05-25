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

  const platformAddress = process.env.NEXT_PUBLIC_PLATFORM_ADDRESS || 'Our authentication center'
  const addressBlock = `<div style="background:#f4f4f5;border-radius:8px;padding:16px;margin-top:16px;">
        <p style="margin:0 0 4px;font-weight:600;color:#18181b;">Ship to our authentication center:</p>
        <p style="margin:0;color:#3f3f46;">${platformAddress}</p>
      </div>`

  const payout = (total - platformFee).toFixed(2)

  await getResend().emails.send({
    from: `nomi market <${FROM}>`,
    to: sellerEmail,
    subject: `New order! Generate a label — Order #${orderId.slice(0, 8)}`,
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
            Generate Shipping Label
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

        <p style="color:#71717a;margin-top:16px;">The seller will ship your card to our authentication center. Once verified, we&rsquo;ll ship it directly to you.</p>

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

// ─── Admin: Seller Shipped to Platform ───────────────────────────

export async function sendAdminSellerShippedEmail({
  adminEmail,
  sellerName,
  orderId,
  trackingNumber,
  trackingCarrier,
}: {
  adminEmail: string
  sellerName: string
  orderId: string
  trackingNumber?: string | null
  trackingCarrier?: string | null
}) {
  const trackingBlock =
    trackingNumber
      ? `<div style="background:#f4f4f5;border-radius:8px;padding:16px;margin-top:16px;">
          <p style="margin:0 0 4px;font-weight:600;color:#18181b;">Seller tracking info</p>
          ${trackingCarrier ? `<p style="margin:0;color:#3f3f46;">Carrier: ${trackingCarrier}</p>` : ''}
          <p style="margin:0;color:#3f3f46;">Tracking #: ${trackingNumber}</p>
        </div>`
      : ''

  await getResend().emails.send({
    from: `nomi market <${FROM}>`,
    to: adminEmail,
    subject: `Seller shipped — Order #${orderId.slice(0, 8)}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;">
        <h1 style="color:#18181b;font-size:24px;margin-bottom:4px;">Incoming shipment</h1>
        <p style="color:#71717a;margin-top:0;">${sellerName || 'A seller'} has shipped their card for Order #${orderId.slice(0, 8)}.</p>

        ${trackingBlock}

        <div style="margin-top:24px;text-align:center;">
          <a href="${SITE_URL}/admin" style="display:inline-block;background:#f97316;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
            View in Admin Panel
          </a>
        </div>

        <p style="margin-top:32px;font-size:12px;color:#a1a1aa;text-align:center;">nomi market &middot; The Trusted TCG Marketplace</p>
      </div>
    `,
  })
}

// ─── Seller: Status Update (Received / Authenticated) ────────────

const STATUS_MESSAGES: Record<string, { subject: string; heading: string; body: string }> = {
  received: {
    subject: 'Card received',
    heading: 'We received your card!',
    body: 'Your card has arrived at our authentication center. We\'ll verify it and update you shortly.',
  },
  authenticated: {
    subject: 'Card authenticated',
    heading: 'Your card has been authenticated!',
    body: 'Great news! Your card passed authentication. Your payout has been credited to your balance. We\'ll now ship it to the buyer.',
  },
}

export async function sendSellerStatusUpdateEmail({
  sellerEmail,
  sellerName,
  orderId,
  status,
}: {
  sellerEmail: string
  sellerName: string
  orderId: string
  status: string
}) {
  const msg = STATUS_MESSAGES[status]
  if (!msg) return

  await getResend().emails.send({
    from: `nomi market <${FROM}>`,
    to: sellerEmail,
    subject: `${msg.subject} — Order #${orderId.slice(0, 8)}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;">
        <h1 style="color:#18181b;font-size:24px;margin-bottom:4px;">${msg.heading}</h1>
        <p style="color:#71717a;margin-top:0;">Hi ${sellerName || 'there'}, here's an update on Order #${orderId.slice(0, 8)}.</p>

        <p style="color:#3f3f46;margin-top:16px;">${msg.body}</p>

        <div style="margin-top:24px;text-align:center;">
          <a href="${SITE_URL}/orders/${orderId}" style="display:inline-block;background:#f97316;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
            View Order
          </a>
        </div>

        <p style="margin-top:32px;font-size:12px;color:#a1a1aa;text-align:center;">nomi market &middot; The Trusted TCG Marketplace</p>
      </div>
    `,
  })
}

// ─── Exception emails (Auth Flow Phase 4) ────────────────────────

/** Per-item exception summary used in both buyer and seller exception
 *  emails. Each item can carry multiple exceptions (Wrong Card +
 *  Conditional, for example) — we render one line per exception so
 *  the recipient sees the full picture. */
export interface ExceptionItemSummary {
  card_name: string
  exceptions: Array<{
    type: 'incorrect_product' | 'fake' | 'conditional' | 'physical_damage'
    details: Record<string, unknown>
  }>
}

/** Buyer-friendly summary line per exception type. Plain language —
 *  the buyer doesn't care about our internal taxonomy, they care that
 *  the card they bought isn't what was listed. */
function buyerSummary(ex: ExceptionItemSummary['exceptions'][number]): string {
  switch (ex.type) {
    case 'incorrect_product': {
      const d = ex.details as { received_type?: string; received_card_name?: string }
      if (d.received_type === 'wrong_card') {
        return d.received_card_name
          ? `The seller shipped <strong>${d.received_card_name}</strong> instead of the card you ordered.`
          : `The seller shipped the wrong card.`
      }
      if (d.received_type === 'slab') {
        return `The seller shipped a graded slab, but you ordered a raw card.`
      }
      if (d.received_type === 'raw') {
        return `The seller shipped a raw card, but you ordered a graded slab.`
      }
      return `The product didn't match the listing.`
    }
    case 'fake': {
      return `Our authenticators determined the card is not authentic.`
    }
    case 'conditional': {
      const d = ex.details as { actual_condition?: string }
      const cond = d.actual_condition === 'lightly_played' ? 'Lightly Played'
        : d.actual_condition === 'heavily_played' ? 'Heavily Played'
        : 'lower than listed'
      return `The card is in <strong>${cond}</strong> condition — below what the listing claimed.`
    }
    case 'physical_damage': {
      return `The card arrived with physical damage.`
    }
  }
}

/** Seller-side summary line per exception. More clinical than the
 *  buyer version — the seller already knows the card they sent, so
 *  we tell them what we found and what happens next. */
function sellerSummary(ex: ExceptionItemSummary['exceptions'][number]): string {
  switch (ex.type) {
    case 'incorrect_product': {
      const d = ex.details as { received_type?: string }
      const what = d.received_type === 'wrong_card' ? 'a different card than listed'
        : d.received_type === 'slab' ? 'a graded slab instead of the listed raw card'
        : d.received_type === 'raw' ? 'a raw card instead of the listed graded slab'
        : 'something other than what was listed'
      return `<strong>Wrong product:</strong> we received ${what}. The card will be relisted on consignment.`
    }
    case 'fake': {
      const d = ex.details as { disposition?: string }
      if (d.disposition === 'return_to_seller') {
        return `<strong>Authenticity failed:</strong> we determined the card is not authentic. We'll ship it back to you with tracking.`
      }
      return `<strong>Authenticity failed:</strong> we determined the card is not authentic. Per intake instructions, the card will be destroyed.`
    }
    case 'conditional': {
      const d = ex.details as { actual_condition?: string; damage_areas?: string[] }
      const cond = d.actual_condition === 'lightly_played' ? 'Lightly Played'
        : d.actual_condition === 'heavily_played' ? 'Heavily Played'
        : 'lower than the listing'
      const areas = d.damage_areas && d.damage_areas.length > 0
        ? ` (${d.damage_areas.join(', ')})` : ''
      return `<strong>Condition downgrade:</strong> grader marked the card ${cond}${areas}. It'll be relisted on consignment at the new condition.`
    }
    case 'physical_damage': {
      const d = ex.details as { attribution?: string }
      if (d.attribution === 'courier') {
        return `<strong>Damaged in transit:</strong> the courier damaged the card. We're buying you out at the sale price and filing a carrier claim — no action needed from you.`
      }
      if (d.attribution === 'nomi') {
        return `<strong>Damaged in our handling:</strong> we damaged the card and are buying you out at the sale price. We're sorry.`
      }
      return `<strong>Damaged on arrival:</strong> the card was damaged when we received it. It'll be relisted on consignment at a damaged grade.`
    }
  }
}

function renderItemBlock(item: ExceptionItemSummary, fmt: 'buyer' | 'seller'): string {
  const fn = fmt === 'buyer' ? buyerSummary : sellerSummary
  return `
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px;margin-bottom:10px;">
      <p style="margin:0 0 6px;font-weight:600;color:#92400e;">${item.card_name}</p>
      ${item.exceptions.map(ex => `<p style="margin:0;color:#78350f;font-size:14px;line-height:1.5;">${fn(ex)}</p>`).join('')}
    </div>
  `
}

/** Buyer-facing: order has been flagged for exception review. Replaces
 *  the stub I left in finalize-auth that just sent the generic
 *  "received" template. The buyer needs to know there's a problem *now*
 *  rather than waiting until ops resolves it — most exception orders
 *  end in a refund + relisting, and the buyer should hear that journey
 *  start, not just the conclusion. */
export async function sendBuyerExceptionReviewEmail({
  buyerEmail,
  buyerName,
  orderId,
  items,
}: {
  buyerEmail: string
  buyerName: string
  orderId: string
  items: ExceptionItemSummary[]
}) {
  const itemBlocks = items.map(item => renderItemBlock(item, 'buyer')).join('')

  await getResend().emails.send({
    from: `nomi market <${FROM}>`,
    to: buyerEmail,
    subject: `We found an issue with your order — #${orderId.slice(0, 8)}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;">
        <h1 style="color:#18181b;font-size:24px;margin-bottom:4px;">There's an issue with your order</h1>
        <p style="color:#71717a;margin-top:0;">Hi ${buyerName || 'there'}, our authenticators found one or more issues with the cards in Order #${orderId.slice(0, 8)} when they arrived at our center.</p>

        ${itemBlocks}

        <div style="background:#f4f4f5;border-radius:8px;padding:16px;margin-top:16px;">
          <p style="margin:0 0 6px;font-weight:600;color:#18181b;">What happens next</p>
          <p style="margin:0;color:#3f3f46;font-size:14px;line-height:1.5;">Our team is processing the resolution now — usually a refund + a re-listing of the card if you still want it. You'll hear from us within 24 hours with specifics. No action needed from you right now.</p>
        </div>

        <div style="margin-top:24px;text-align:center;">
          <a href="${SITE_URL}/orders/${orderId}" style="display:inline-block;background:#f97316;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
            View Order
          </a>
        </div>

        <p style="margin-top:32px;font-size:12px;color:#a1a1aa;text-align:center;">nomi market &middot; The Trusted TCG Marketplace</p>
      </div>
    `,
  })
}

/** Seller-facing: their item(s) failed authentication or condition
 *  review. Tells them what we found and what we're doing — including
 *  the financial consequence (buyout vs consignment vs return). */
export async function sendSellerExceptionEmail({
  sellerEmail,
  sellerName,
  orderId,
  items,
}: {
  sellerEmail: string
  sellerName: string
  orderId: string
  items: ExceptionItemSummary[]
}) {
  const itemBlocks = items.map(item => renderItemBlock(item, 'seller')).join('')

  await getResend().emails.send({
    from: `nomi market <${FROM}>`,
    to: sellerEmail,
    subject: `Authentication outcome — Order #${orderId.slice(0, 8)}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;">
        <h1 style="color:#18181b;font-size:24px;margin-bottom:4px;">Authentication outcome</h1>
        <p style="color:#71717a;margin-top:0;">Hi ${sellerName || 'there'}, here's what our authenticators found on Order #${orderId.slice(0, 8)}.</p>

        ${itemBlocks}

        <div style="background:#f4f4f5;border-radius:8px;padding:16px;margin-top:16px;">
          <p style="margin:0;color:#3f3f46;font-size:14px;line-height:1.5;">Any consignment or buyout credits will land in your wallet automatically once the disposition is processed. Returns ship within 2 business days.</p>
        </div>

        <div style="margin-top:24px;text-align:center;">
          <a href="${SITE_URL}/orders/${orderId}" style="display:inline-block;background:#f97316;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
            View Order
          </a>
        </div>

        <p style="margin-top:32px;font-size:12px;color:#a1a1aa;text-align:center;">nomi market &middot; The Trusted TCG Marketplace</p>
      </div>
    `,
  })
}

// ─── Buyer: Card Received at Nomi ─────────────────────────────────

/** Sent when the order transitions to `received` — Nomi has the card in
 *  hand and is starting authentication. Closes the silence gap between
 *  "seller shipped" and "shipped to you" (otherwise a 1–2 day blackout
 *  during verification). */
export async function sendBuyerReceivedEmail({
  buyerEmail,
  buyerName,
  orderId,
}: {
  buyerEmail: string
  buyerName: string
  orderId: string
}) {
  await getResend().emails.send({
    from: `nomi market <${FROM}>`,
    to: buyerEmail,
    subject: `We received your card — #${orderId.slice(0, 8)}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;">
        <h1 style="color:#18181b;font-size:24px;margin-bottom:4px;">Your card arrived at Nomi</h1>
        <p style="color:#71717a;margin-top:0;">Hi ${buyerName || 'there'}, the seller&rsquo;s package landed at our authentication center.</p>

        <div style="background:#f4f4f5;border-radius:8px;padding:16px;margin-top:16px;">
          <p style="margin:0 0 8px;font-weight:600;color:#18181b;">What happens next</p>
          <p style="margin:0;color:#3f3f46;">Our team will verify the card matches the listing — condition, grade, authenticity. You&rsquo;ll get another email the moment it passes, usually within 1&ndash;2 business days.</p>
        </div>

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

// ─── Buyer: Card Authenticated ────────────────────────────────────

/** Sent when the order transitions to `authenticated` — the card passed
 *  Nomi's verification but hasn't shipped yet. Without this, the buyer
 *  hears nothing between "received" and "shipped_to_buyer" (which can be
 *  another business day). */
export async function sendBuyerAuthenticatedEmail({
  buyerEmail,
  buyerName,
  orderId,
}: {
  buyerEmail: string
  buyerName: string
  orderId: string
}) {
  await getResend().emails.send({
    from: `nomi market <${FROM}>`,
    to: buyerEmail,
    subject: `Authenticated — your card ships soon — #${orderId.slice(0, 8)}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;">
        <h1 style="color:#18181b;font-size:24px;margin-bottom:4px;">Authenticated &mdash; it&rsquo;s the real deal</h1>
        <p style="color:#71717a;margin-top:0;">Hi ${buyerName || 'there'}, your card passed our verification. It matches the listing&rsquo;s condition and grade.</p>

        <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:16px;margin-top:16px;">
          <p style="margin:0 0 8px;font-weight:600;color:#065f46;">Next up: shipping</p>
          <p style="margin:0;color:#047857;">We&rsquo;re prepping the outbound package now. You&rsquo;ll get tracking the moment it leaves our center.</p>
        </div>

        <div style="margin-top:24px;text-align:center;">
          <a href="${SITE_URL}/orders/${orderId}" style="display:inline-block;background:#f97316;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
            View Order
          </a>
        </div>

        <p style="margin-top:32px;font-size:12px;color:#a1a1aa;text-align:center;">nomi market &middot; The Trusted TCG Marketplace</p>
      </div>
    `,
  })
}

// ─── Buyer: Card Authenticated & Shipped ─────────────────────────

export async function sendBuyerShippedToBuyerEmail({
  buyerEmail,
  buyerName,
  orderId,
  trackingNumber,
  trackingCarrier,
}: {
  buyerEmail: string
  buyerName: string
  orderId: string
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
    subject: `Your card is on its way! — #${orderId.slice(0, 8)}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;">
        <h1 style="color:#18181b;font-size:24px;margin-bottom:4px;">Your card has been authenticated and shipped!</h1>
        <p style="color:#71717a;margin-top:0;">Hi ${buyerName || 'there'}, your card passed authentication and is on its way to you.</p>

        ${trackingBlock}

        <div style="margin-top:24px;text-align:center;">
          <a href="${SITE_URL}/orders/${orderId}" style="display:inline-block;background:#f97316;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
            Track Your Order
          </a>
        </div>

        <p style="color:#71717a;margin-top:16px;">Once you receive your card, visit the order page to confirm delivery and leave a review.</p>

        <p style="margin-top:32px;font-size:12px;color:#a1a1aa;text-align:center;">nomi market &middot; The Trusted TCG Marketplace</p>
      </div>
    `,
  })
}
