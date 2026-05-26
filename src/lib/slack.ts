/** Lightweight Slack notification helper for admin-facing events
 *  (orders flagged for review, exceptions surfaced, label failures,
 *  etc.). Uses an Incoming Webhook URL — no Slack app token to
 *  manage, no per-channel auth, just one URL per workspace channel.
 *
 *  Setup:
 *   1. In Slack, create an Incoming Webhook for the target channel
 *      (Apps → Incoming Webhooks → Add to Slack → pick a channel).
 *   2. Copy the webhook URL into `.env.local` as SLACK_WEBHOOK_URL.
 *   3. Done. No restart needed beyond the normal Next.js dev cycle.
 *
 *  All notifications are best-effort: a missing env var, network
 *  error, or non-200 response logs but never throws into the
 *  originating flow. A failed Slack ping must never roll back a
 *  real database transaction. */

const WEBHOOK = process.env.SLACK_WEBHOOK_URL || ''
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

interface NotifyOptions {
  /** Plain-text fallback shown in mobile notifications + threading
   *  previews. Slack-formatted (bold via *, italic via _, code via `).
   *  Required even when blocks are provided. */
  text: string
  /** Optional Slack blocks for richer in-channel rendering. If absent
   *  the channel just shows `text`. */
  blocks?: unknown[]
  /** Tag the notification with a kind so future filtering / silencing
   *  is easier (e.g. "order_under_review", "exception_review"). Goes
   *  into the message metadata, doesn't render. */
  kind?: string
}

/** Fire-and-forget Slack notification. Never throws. */
export async function notifySlack(opts: NotifyOptions): Promise<void> {
  if (!WEBHOOK) {
    // Default-off in dev: skip silently rather than spam console on
    // every event. Set SLACK_WEBHOOK_URL=... in .env.local to enable.
    return
  }
  try {
    const res = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: opts.text,
        blocks: opts.blocks,
      }),
      // Short timeout — if Slack is being slow, we'd rather drop the
      // notification than hold up the originating request.
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      console.error('[slack] webhook returned', res.status, await res.text().catch(() => ''))
    }
  } catch (err) {
    console.error('[slack] notify failed', err)
  }
}

// ─────────────────────────────────────────────────────────────────
// Convenience wrappers — pre-formatted notifications for each
// admin-priority event we care about. Keeps the originating code
// simple (`notifyOrderUnderReview({orderId, reasons})`) without
// every caller hand-rolling Slack block JSON.
// ─────────────────────────────────────────────────────────────────

export async function notifyOrderUnderReview({
  orderId,
  reasons,
  buyerName,
  total,
}: {
  orderId: string
  reasons: string[]
  buyerName?: string
  total?: number
}): Promise<void> {
  const shortId = orderId.slice(0, 8).toUpperCase()
  const totalStr = total != null ? `$${total.toFixed(2)}` : ''
  const reasonStr = reasons.length > 0 ? reasons.map(r => `\`${r}\``).join(', ') : '(no specific signals)'

  await notifySlack({
    kind: 'order_under_review',
    text: `:rotating_light: Order under review #${shortId} — ${reasonStr}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:rotating_light: *Order flagged for review* — #${shortId}${totalStr ? ` (${totalStr})` : ''}${buyerName ? `\nBuyer: ${buyerName}` : ''}\nReasons: ${reasonStr}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `<${SITE_URL}/admin/risk|Open risk inbox →>`,
          },
        ],
      },
    ],
  })
}

export async function notifyExceptionReview({
  orderId,
  exceptionTypes,
  buyerName,
}: {
  orderId: string
  exceptionTypes: string[]
  buyerName?: string
}): Promise<void> {
  const shortId = orderId.slice(0, 8).toUpperCase()
  const dedup = [...new Set(exceptionTypes)]
  const typeStr = dedup.length > 0 ? dedup.map(t => `\`${t}\``).join(', ') : '(unspecified)'

  await notifySlack({
    kind: 'exception_review',
    text: `:warning: Exception review #${shortId} — ${typeStr}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:warning: *Order flagged at authentication* — #${shortId}${buyerName ? `\nBuyer: ${buyerName}` : ''}\nExceptions: ${typeStr}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `<${SITE_URL}/admin/orders/${orderId}|Resolve →>`,
          },
        ],
      },
    ],
  })
}

export async function notifyBuyoutCreated({
  orderId,
  amount,
  attribution,
  sellerName,
}: {
  orderId: string
  amount: number
  attribution: 'courier' | 'nomi'
  sellerName?: string
}): Promise<void> {
  const shortId = orderId.slice(0, 8).toUpperCase()
  const attr = attribution === 'courier' ? 'courier-damaged' : 'damaged in our handling'

  await notifySlack({
    kind: 'buyout_created',
    text: `:moneybag: Buyout: $${amount.toFixed(2)} (${attr}) — #${shortId}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:moneybag: *Buyout posted* — #${shortId}\n${attr} · $${amount.toFixed(2)} credited to ${sellerName || 'seller'}${attribution === 'courier' ? '\n_Reminder: file the carrier claim from /admin/inventory_' : ''}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `<${SITE_URL}/admin/inventory?tab=buyouts|Open inventory →>`,
          },
        ],
      },
    ],
  })
}

export async function notifyLabelFailure({
  orderId,
  errorMessage,
  side,
}: {
  orderId: string
  errorMessage: string
  side: 'inbound' | 'outbound'
}): Promise<void> {
  const shortId = orderId.slice(0, 8).toUpperCase()
  await notifySlack({
    kind: 'label_failure',
    text: `:x: ${side} label gen failed for #${shortId}: ${errorMessage}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:x: *${side === 'outbound' ? 'Outbound' : 'Inbound'} label generation failed* — #${shortId}\n\`${errorMessage}\``,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `<${SITE_URL}/admin/orders/${orderId}|Open order →>`,
          },
        ],
      },
    ],
  })
}
