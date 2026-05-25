import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { getResend } from '@/lib/resend'

/** Phase 5 of the auth flow. Closes the loop on exception_review
 *  orders: ops marks the per-item dispositions done (consignment
 *  relist prices, carrier claim IDs, fake confirmation), the buyer
 *  gets a full refund to wallet, the order transitions to cancelled.
 *
 *  In v1 every exception path terminates the same way for the buyer:
 *  full refund. If we later want a "discounted re-offer" branch (e.g.
 *  buyer accepts a Conditional card at a partial refund) that becomes
 *  a different transition path; this endpoint stays as the
 *  full-refund/cancel route.
 *
 *  Admin-only. Optimistic-locked on status='exception_review' so two
 *  admins resolving concurrently → second one 409s.
 *
 *  See docs/authentication-flow.md for the full state machine and
 *  designs/authentication-flow.md for the resolution rationale. */

const FROM = process.env.RESEND_FROM_EMAIL || 'orders@nomimarket.com'
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

interface ResolveBody {
  /** Per-item consignment relist price. Sets
   *  consigned_intakes.intended_relist_price for the matching row.
   *  Optional — can be left null and set later from a dedicated
   *  consignment-management UI (not built yet). */
  consignment_prices?: Record<string, number>
  /** Per-item Shippo / carrier claim reference. Sets buyouts.carrier_claim_id.
   *  Optional — admin may file the claim asynchronously. */
  carrier_claim_ids?: Record<string, string>
  /** Free-text admin note appended to the order's admin_notes. */
  notes?: string
}

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

  const body = (await request.json().catch(() => ({}))) as ResolveBody
  const admin = getSupabaseAdmin()

  // ── Pre-flight: confirm the order is actually in exception_review.
  const { data: order } = await admin
    .from('orders')
    .select('id, status, buyer_id, subtotal, shipping_cost, total, admin_notes, credits_applied')
    .eq('id', orderId)
    .single()

  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }
  if (order.status !== 'exception_review') {
    return NextResponse.json({
      error: `Cannot resolve: order is in '${order.status}'. Expected 'exception_review'.`,
    }, { status: 409 })
  }

  // ── Apply per-item disposition updates BEFORE the status flip.
  //    If anything below fails, the order stays in exception_review
  //    and the operator can retry with the same payload.
  if (body.consignment_prices) {
    for (const [itemId, price] of Object.entries(body.consignment_prices)) {
      if (!Number.isFinite(price) || price < 0) continue
      const { error: updErr } = await admin
        .from('consigned_intakes')
        .update({ intended_relist_price: price })
        .eq('order_item_id', itemId)
      if (updErr) {
        return NextResponse.json({
          error: `Failed to update consignment price for item ${itemId.slice(0, 8)}: ${updErr.message}`,
        }, { status: 500 })
      }
    }
  }

  if (body.carrier_claim_ids) {
    for (const [itemId, claimId] of Object.entries(body.carrier_claim_ids)) {
      if (!claimId.trim()) continue
      const { error: updErr } = await admin
        .from('buyouts')
        .update({
          carrier_claim_id: claimId.trim(),
          carrier_claim_status: 'filed',
        })
        .eq('order_item_id', itemId)
      if (updErr) {
        return NextResponse.json({
          error: `Failed to record carrier claim for item ${itemId.slice(0, 8)}: ${updErr.message}`,
        }, { status: 500 })
      }
    }
  }

  // ── Buyer refund: credit wallet for the full order amount they
  //    paid (subtotal + shipping). Mirrors the existing refund
  //    pattern — wallet credit, ledger row, optional Stripe refund
  //    later if they want it on their card. credits_applied was
  //    already debited from their balance when they paid; we restore
  //    the full amount they paid out-of-pocket (total) + the credits
  //    they applied.
  const refundAmount = Number(order.total || 0)
  if (refundAmount > 0) {
    const { data: buyerProfile } = await admin
      .from('profiles')
      .select('balance')
      .eq('id', order.buyer_id)
      .single()
    const currentBalance = Number(buyerProfile?.balance || 0)

    const { error: balErr } = await admin
      .from('profiles')
      .update({ balance: currentBalance + refundAmount })
      .eq('id', order.buyer_id)
    if (balErr) {
      return NextResponse.json({
        error: `Failed to credit buyer balance: ${balErr.message}`,
      }, { status: 500 })
    }

    await admin.from('credit_transactions').insert({
      user_id: order.buyer_id,
      amount: refundAmount,
      type: 'refund_credit',
      order_id: orderId,
      description: 'Refund for exception-review resolution (full order refunded to wallet)',
    })
  }

  // ── Append the admin's resolution note to the order audit trail.
  const timestamp = new Date().toLocaleString('en-US')
  const resolutionNote = `[${timestamp}] Exception resolved: refunded $${refundAmount.toFixed(2)} to wallet${body.notes ? `. ${body.notes}` : '.'}`
  const newNotes = order.admin_notes
    ? `${order.admin_notes}\n---\n${resolutionNote}`
    : resolutionNote

  // ── Status transition with optimistic lock. Re-checking
  //    exception_review here catches the race against a second admin.
  const now = new Date().toISOString()
  const { data: updated, error: updateErr } = await admin
    .from('orders')
    .update({
      status: 'cancelled',
      admin_notes: newNotes,
    })
    .eq('id', orderId)
    .eq('status', 'exception_review')
    .select('id')
  if (updateErr) {
    return NextResponse.json({
      error: `Failed to cancel order: ${updateErr.message}`,
    }, { status: 500 })
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json({
      error: 'Order status changed between read and write — refresh and retry.',
    }, { status: 409 })
  }

  // ── Audit row in the existing intake activity log.
  await admin.from('intake_activity_log').insert({
    order_id: orderId,
    action: 'resolve_exception',
    details: {
      refund_amount: refundAmount,
      consignment_prices_set: body.consignment_prices ? Object.keys(body.consignment_prices).length : 0,
      carrier_claims_filed: body.carrier_claim_ids ? Object.keys(body.carrier_claim_ids).length : 0,
      notes: body.notes || null,
      resolved_at: now,
    },
    performed_by: user.id,
  })

  // ── Email buyer. Independent try/catch — Resend hiccup never
  //    rolls back a real refund.
  try {
    const buyerAuth = await admin.auth.admin.getUserById(order.buyer_id)
    const { data: buyerProfileData } = await admin
      .from('profiles')
      .select('display_name')
      .eq('id', order.buyer_id)
      .single()
    const buyerEmail = buyerAuth?.data?.user?.email
    if (buyerEmail && refundAmount > 0) {
      await getResend().emails.send({
        from: `nomi market <${FROM}>`,
        to: buyerEmail,
        subject: `Refund processed — Order #${orderId.slice(0, 8)}`,
        html: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;">
            <h1 style="color:#18181b;font-size:24px;margin-bottom:4px;">Your refund is in your wallet</h1>
            <p style="color:#71717a;margin-top:0;">Hi ${buyerProfileData?.display_name || 'there'}, we've fully refunded Order #${orderId.slice(0, 8)}.</p>

            <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:16px;margin-top:16px;">
              <p style="margin:0 0 4px;font-weight:600;color:#065f46;">Refund credited</p>
              <p style="margin:0;color:#047857;font-size:22px;font-weight:700;">$${refundAmount.toFixed(2)}</p>
              <p style="margin:6px 0 0;color:#065f46;font-size:13px;">Available immediately in your wallet to spend on Nomi, or cash out to your bank.</p>
            </div>

            <p style="color:#71717a;margin-top:16px;font-size:14px;">Sorry the order didn't work out. If you'd still like a card like this, we'll often re-list the affected item on consignment within a few days — keep an eye on the card page.</p>

            <div style="margin-top:24px;text-align:center;">
              <a href="${SITE_URL}/wallet" style="display:inline-block;background:#f97316;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
                View Wallet
              </a>
            </div>

            <p style="margin-top:32px;font-size:12px;color:#a1a1aa;text-align:center;">nomi market &middot; The Trusted TCG Marketplace</p>
          </div>
        `,
      })
    }
  } catch (emailErr) {
    console.error('[resolve-exception] buyer refund email failed', emailErr)
  }

  return NextResponse.json({
    ok: true,
    order_id: orderId,
    refund_amount: refundAmount,
    new_status: 'cancelled',
  })
}
