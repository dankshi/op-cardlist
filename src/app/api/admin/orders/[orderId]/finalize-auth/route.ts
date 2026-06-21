import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import {
  sendBuyerAuthenticatedEmail,
  sendBuyerExceptionReviewEmail,
  sendSellerExceptionEmail,
  type ExceptionItemSummary,
} from '@/lib/email'
import { notifyExceptionReview, notifyBuyoutCreated } from '@/lib/slack'
import { recordOrderRaffleEntries } from '@/lib/raffle'

/** Commits the per-item auth decisions into an order-level status
 *  transition and triggers the data side-effects (a consignment
 *  submission + items for exception cards, buyouts rows). Seller
 *  credit math for clean orders still flows
 *  through the existing status route — we set status='authenticated'
 *  there and the existing branch picks it up. For exception_review
 *  orders, seller credit happens later, per-resolution, in the
 *  per-item exception resolution endpoint (follow-up commit).
 *
 *  Computes the next status:
 *    - all items authentic + near_mint → 'authenticated'
 *    - any item flagged (fake or exception) → 'exception_review'
 *
 *  See docs/authentication-flow.md for the full state machine. */

interface OrderItemRow {
  id: string
  auth_decision: string
  auth_condition: string | null
  exception_types: string[]
  exception_details: Record<string, unknown>
  unit_price: number | string
  quantity: number
  card_id: string
  card_name: string | null
}

export async function POST(
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

  const adminSupabase = getSupabaseAdmin()

  // ── Optimistic lock: order must be in 'received' (clean finalize)
  //    OR 'exception_review' (re-finalize after admin edits decisions).
  //    Two admins finalizing concurrently → second one gets 409 here.
  const { data: order } = await supabase
    .from('orders')
    .select('id, status, buyer_id, seller_id')
    .eq('id', orderId)
    .single()

  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  if (order.status !== 'received' && order.status !== 'exception_review') {
    return NextResponse.json({
      error: `Cannot finalize: order is in '${order.status}'. Expected 'received' or 'exception_review'.`,
    }, { status: 409 })
  }

  // ── Pull all items with their decisions. Every item must have a
  //    decision recorded (auth_decision !== 'pending') before we can
  //    commit the order-level transition.
  const { data: items } = await supabase
    .from('order_items')
    .select('id, auth_decision, auth_condition, exception_types, exception_details, unit_price, quantity, card_id, card_name')
    .eq('order_id', orderId)

  if (!items || items.length === 0) {
    return NextResponse.json({ error: 'Order has no items' }, { status: 400 })
  }

  const typedItems = items as OrderItemRow[]
  const pendingItems = typedItems.filter(i => i.auth_decision === 'pending')
  if (pendingItems.length > 0) {
    return NextResponse.json({
      error: `${pendingItems.length} item(s) still need a decision. Authenticate or flag them before finalizing.`,
    }, { status: 400 })
  }

  // ── Determine next status. Clean pass = every item is authentic+NM.
  //    Anything else routes through exception_review for resolution.
  const isCleanPass = typedItems.every(
    i => i.auth_decision === 'authentic' && i.auth_condition === 'near_mint',
  )
  const nextStatus = isCleanPass ? 'authenticated' : 'exception_review'

  // ── Lazily get-or-create the single exception-origin consignment
  //    submission for this order. Exception cards consign under the
  //    unified consignment model (channel='exception') — same economics
  //    as a seller-initiated consignment, just an involuntary entry
  //    point. One submission groups all of an order's flagged cards;
  //    the partial unique index on origin_order_id makes re-finalize
  //    reuse the same row. Created only if at least one item consigns.
  let exceptionSubmissionId: string | null = null
  async function ensureExceptionSubmission(): Promise<string> {
    if (exceptionSubmissionId) return exceptionSubmissionId
    const { data: existing } = await adminSupabase
      .from('consignment_submissions')
      .select('id')
      .eq('origin_order_id', orderId)
      .eq('channel', 'exception')
      .maybeSingle()
    if (existing) {
      exceptionSubmissionId = existing.id
      return existing.id
    }
    const { data: created, error: subErr } = await adminSupabase
      .from('consignment_submissions')
      .insert({
        seller_id: order!.seller_id,
        channel: 'exception',
        status: 'processing',
        origin_order_id: orderId,
      })
      .select('id')
      .single()
    if (subErr || !created) {
      throw new Error(`Failed to create consignment submission: ${subErr?.message}`)
    }
    exceptionSubmissionId = created.id
    return created.id
  }

  // ── Record the per-item side-effects. We do this BEFORE flipping
  //    order status so a partial failure leaves the order in
  //    'received' for retry (rather than 'exception_review' with
  //    missing consignment/buyout rows). Consignment items are guarded
  //    against duplicates on re-finalize via origin_order_item_id.
  for (const item of typedItems) {
    // Skip clean items — they have no per-item side-effect to record.
    if (item.auth_decision === 'authentic' && item.auth_condition === 'near_mint') continue

    // Fake decision: no consignment, no buyout. Disposition (return
    // vs destroy) is captured in exception_details and acted on by
    // ops from /admin/orders. v1 just records; physical-flow follows.
    if (item.auth_decision === 'fake') continue

    for (const exType of item.exception_types) {
      // Detail key matches the exception_type — set by auth-decision endpoint.
      const details = (item.exception_details as Record<string, unknown>)[exType]

      // physical_damage attributed to courier/nomi → buyout the
      // seller. Attribution=seller falls through to consignment.
      if (exType === 'physical_damage') {
        const det = details as { attribution: 'courier' | 'nomi' | 'seller'; notes?: string } | undefined
        if (det?.attribution === 'courier' || det?.attribution === 'nomi') {
          const buyoutAmount = Number(item.unit_price) * item.quantity
          await adminSupabase.from('buyouts').insert({
            order_item_id: item.id,
            seller_id: order.seller_id,
            amount: buyoutAmount,
            reason: `physical_damage:${det.attribution}`,
            carrier_claim_status: det.attribution === 'courier' ? 'pending' : null,
            notes: det.notes ?? null,
          })
          // Slack ping — buyouts are real money out the door, ops
          // should see them surface. Fire-and-forget.
          notifyBuyoutCreated({
            orderId,
            amount: buyoutAmount,
            attribution: det.attribution,
          })
          continue
        }
      }

      // Default exception side-effect: consignment. Covers
      // incorrect_product (any received_type), conditional (any
      // played grade), physical_damage by seller. The card is already
      // in hand (it arrived on this order), so the item starts at
      // 'confirmed' under the order's exception submission.
      const submissionId = await ensureExceptionSubmission()
      // Idempotent on re-finalize: skip if this exception is already recorded.
      const { data: existingItem } = await adminSupabase
        .from('consignment_items')
        .select('id')
        .eq('origin_order_item_id', item.id)
        .eq('exception_type', exType)
        .maybeSingle()
      if (existingItem) continue
      await adminSupabase.from('consignment_items').insert({
        submission_id: submissionId,
        seller_id: order.seller_id,
        card_id: item.card_id,
        kind: 'raw',
        origin_order_item_id: item.id,
        exception_type: exType,
        status: 'confirmed',
        notes: typeof details === 'object' && details !== null ? JSON.stringify(details) : null,
      })
    }
  }

  // ── Flip the order status + stamp the audit timestamp.
  const update: Record<string, unknown> = { status: nextStatus }
  if (nextStatus === 'authenticated') {
    update.authenticated_at = new Date().toISOString()
  }
  // For exception_review we don't set authenticated_at — the order
  // hasn't actually been authenticated, just triaged into the
  // resolution queue.

  const { error: updateError } = await adminSupabase
    .from('orders')
    .update(update)
    .eq('id', orderId)
    // Re-check the status precondition. Catches the race where a
    // second admin finalized between our SELECT and UPDATE.
    .in('status', ['received', 'exception_review'])

  if (updateError) {
    return NextResponse.json({
      error: `Failed to update order status: ${updateError.message}`,
    }, { status: 500 })
  }

  // ── Raffle entries for a clean authentication. Best-effort,
  //    never throws — see lib/raffle.ts. Skips for exception_review
  //    (entries fire when the order ultimately settles into
  //    authenticated, not while it's still in triage).
  if (nextStatus === 'authenticated') {
    await recordOrderRaffleEntries({
      orderId,
      buyerId: order.buyer_id,
      sellerId: order.seller_id,
      items: typedItems.map(i => ({ id: i.id, quantity: i.quantity })),
    })
  }

  // ── Notify buyer + seller. Each email is independently
  //    try/catch'd so a Resend hiccup doesn't break the others.
  //    For exception_review we send the bespoke per-exception
  //    email with item-by-item summaries; for clean authenticated
  //    orders the existing status route's authenticated branch
  //    already emails the seller about their credit (we just send
  //    the buyer their "authenticated, shipping soon" note here).
  const exceptionItems: ExceptionItemSummary[] = typedItems
    .filter(i => i.exception_types.length > 0 || i.auth_decision === 'fake')
    .map(i => ({
      card_name: i.card_name || 'Unknown card',
      exceptions: i.exception_types.map(t => ({
        type: t as ExceptionItemSummary['exceptions'][number]['type'],
        details: (i.exception_details as Record<string, unknown>)[t] as Record<string, unknown>,
      })),
    }))

  await notifyParties({
    orderId,
    buyerId: order.buyer_id,
    sellerId: order.seller_id,
    nextStatus,
    exceptionItems,
  })

  // ── Slack ping if we routed to exception_review — ops needs to
  //    know there's resolution work pending. Skipped for clean
  //    authenticated orders (those are the happy path; no admin
  //    action required).
  if (nextStatus === 'exception_review' && exceptionItems.length > 0) {
    const allTypes = exceptionItems.flatMap(i => i.exceptions.map(e => e.type))
    notifyExceptionReview({
      orderId,
      exceptionTypes: allTypes,
    })
  }

  // Audit row — mirrors the per-item logs we wrote in auth-decision.
  await adminSupabase.from('intake_activity_log').insert({
    order_id: orderId,
    action: `finalize_auth:${nextStatus}`,
    details: {
      next_status: nextStatus,
      item_count: typedItems.length,
      clean_count: typedItems.filter(
        i => i.auth_decision === 'authentic' && i.auth_condition === 'near_mint',
      ).length,
    },
    performed_by: user.id,
  })

  return NextResponse.json({
    ok: true,
    status: nextStatus,
    clean_pass: isCleanPass,
  })
}

/** Send the buyer + seller emails appropriate to the new order status.
 *  Each branch is independently try/catch'd so a single Resend failure
 *  doesn't cascade. Failed emails are logged for manual replay. */
async function notifyParties({
  orderId,
  buyerId,
  sellerId,
  nextStatus,
  exceptionItems,
}: {
  orderId: string
  buyerId: string
  sellerId: string
  nextStatus: 'authenticated' | 'exception_review'
  exceptionItems: ExceptionItemSummary[]
}) {
  const adminSupabase = getSupabaseAdmin()

  // Fetch buyer + seller info in parallel for the email bodies.
  const [buyerAuth, sellerAuth, buyerProfile, sellerProfile] = await Promise.all([
    adminSupabase.auth.admin.getUserById(buyerId),
    adminSupabase.auth.admin.getUserById(sellerId),
    adminSupabase.from('profiles').select('display_name').eq('id', buyerId).single(),
    adminSupabase.from('profiles').select('display_name').eq('id', sellerId).single(),
  ])

  const buyerEmail = buyerAuth?.data?.user?.email
  const sellerEmail = sellerAuth?.data?.user?.email
  const buyerName = buyerProfile?.data?.display_name || ''
  const sellerName = sellerProfile?.data?.display_name || ''

  // ── Buyer email
  if (buyerEmail) {
    try {
      if (nextStatus === 'authenticated') {
        await sendBuyerAuthenticatedEmail({ buyerEmail, buyerName, orderId })
      } else {
        // Bespoke per-exception email — Phase 4 of the auth flow.
        // Replaces the generic "we got your card" stub with item-by-item
        // summaries the buyer can actually act on (or at least understand).
        await sendBuyerExceptionReviewEmail({
          buyerEmail,
          buyerName,
          orderId,
          items: exceptionItems,
        })
      }
    } catch (err) {
      console.error('[finalize-auth] buyer email failed', err)
    }
  }

  // ── Seller email
  // For 'authenticated' clean orders, the existing status route's
  // 'authenticated' branch emails the seller about their credit
  // separately. Here we only email the seller for exception_review
  // with the bespoke per-exception summary so they know what we
  // found and what we're doing (consign / buyout / return / destroy).
  if (sellerEmail && nextStatus === 'exception_review') {
    try {
      await sendSellerExceptionEmail({
        sellerEmail,
        sellerName,
        orderId,
        items: exceptionItems,
      })
    } catch (err) {
      console.error('[finalize-auth] seller email failed', err)
    }
  }
}
