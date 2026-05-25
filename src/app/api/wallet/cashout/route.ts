import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { getStripe } from '@/lib/stripe'
import { validateCashoutRequest, CASHOUT_MIN_AMOUNT } from '@/lib/cashout'
import type Stripe from 'stripe'

// Cashout flow (Stripe Connect Express):
//   1. Validate amount + method against the user's wallet balance.
//   2. Confirm the user's Stripe Express account is payouts-enabled.
//   3. Atomically debit balance via a compare-and-swap UPDATE so two
//      concurrent cashout requests can't overdraw the wallet.
//   4. Write the canonical credit_transactions ledger row + cashouts row
//      (status='pending').
//   5. Push funds platform -> connected account via stripe.transfers.create.
//      For instant payouts, also fire stripe.payouts.create({method:'instant'})
//      on the connected account. Standard mode rides the Express account's
//      default daily payout cadence; the payout.paid webhook will flip the
//      cashouts row to paid.
//   6. Roll back balance + ledger if Stripe transfer fails.
//
// The $1 instant fee is service revenue; we debit (amount + fee) from the
// wallet but only transfer `amount` to Stripe — the $1 stays in the platform
// Stripe balance (covers Stripe's own ~1% instant payout fee + a small margin).
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const { amount, method } = body

  const { data: profile } = await supabase
    .from('profiles')
    .select('balance, stripe_account_id, stripe_onboarding_complete')
    .eq('id', user.id)
    .single()

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  const validation = validateCashoutRequest({
    amount,
    method,
    balance: Number(profile.balance || 0),
  })
  if (!validation.ok) {
    const f = validation.failure
    let message = 'Invalid cashout request'
    if (f.kind === 'amount_below_min') message = `Minimum cashout is $${CASHOUT_MIN_AMOUNT}`
    else if (f.kind === 'amount_invalid') message = 'Invalid amount'
    else if (f.kind === 'method_invalid') message = 'method must be "standard" or "instant"'
    else if (f.kind === 'insufficient_balance') {
      message = `Insufficient balance — need $${f.needed.toFixed(2)}, have $${f.available.toFixed(2)}`
    }
    return NextResponse.json({ error: message }, { status: 400 })
  }
  const quote = validation.quote

  if (!profile.stripe_account_id) {
    return NextResponse.json(
      { error: 'Connect a bank account before cashing out' },
      { status: 400 },
    )
  }

  // Always re-check Stripe directly. Cached flag may lag the account.updated
  // webhook, and a stale flag here would push us into a transfer that fails
  // server-side and forces a rollback.
  const stripe = getStripe()
  let account: Stripe.Account
  try {
    account = await stripe.accounts.retrieve(profile.stripe_account_id)
  } catch (err) {
    console.error('cashout: failed to verify Stripe account', err)
    return NextResponse.json(
      { error: 'Could not verify your bank connection. Try again.' },
      { status: 502 },
    )
  }
  if (!account.payouts_enabled) {
    return NextResponse.json(
      { error: 'Your bank connection is not payouts-enabled yet. Finish Stripe setup.' },
      { status: 400 },
    )
  }

  const admin = getSupabaseAdmin()

  // Compare-and-swap debit. The WHERE re-checks the balance we read above so
  // a concurrent cashout request can't overdraw. 0 rows -> someone else won.
  const newBalance = Number(profile.balance || 0) - quote.totalDebited
  const { data: debited, error: debitErr } = await admin
    .from('profiles')
    .update({ balance: newBalance })
    .eq('id', user.id)
    .gte('balance', quote.totalDebited)
    .select('id')
  if (debitErr || !debited || debited.length === 0) {
    return NextResponse.json(
      { error: 'Balance changed; please refresh and try again' },
      { status: 409 },
    )
  }

  // Write the canonical ledger row first so we have an id to reference from
  // the cashouts row. amount is negative per the credit_amount_sign_matches_type
  // constraint on credit_transactions.
  const { data: ledgerRow, error: ledgerErr } = await admin
    .from('credit_transactions')
    .insert({
      user_id: user.id,
      amount: -quote.totalDebited,
      type: 'cashout',
      description: `Cashout to bank (${method}${quote.fee > 0 ? `, $${quote.fee.toFixed(2)} fee` : ''})`,
      metadata: { method, fee: quote.fee, payout_amount: quote.amount },
    })
    .select()
    .single()

  if (ledgerErr || !ledgerRow) {
    // Compensating credit: put the money back.
    await admin
      .from('profiles')
      .update({ balance: Number(profile.balance || 0) })
      .eq('id', user.id)
    return NextResponse.json({ error: 'Failed to record cashout' }, { status: 500 })
  }

  const { data: cashoutRow, error: cashoutErr } = await admin
    .from('cashouts')
    .insert({
      user_id: user.id,
      amount: quote.amount,
      fee: quote.fee,
      total_debited: quote.totalDebited,
      method,
      status: 'pending',
      credit_transaction_id: ledgerRow.id,
    })
    .select()
    .single()

  if (cashoutErr || !cashoutRow) {
    // Roll back ledger + balance.
    await admin.from('credit_transactions').delete().eq('id', ledgerRow.id)
    await admin
      .from('profiles')
      .update({ balance: Number(profile.balance || 0) })
      .eq('id', user.id)
    return NextResponse.json({ error: 'Failed to create cashout' }, { status: 500 })
  }

  // Now push the money out via Stripe. If either Stripe call throws,
  // unwind the DB writes so the user gets their balance back.
  let stripeTransferId: string | null = null
  let stripePayoutId: string | null = null

  try {
    const transfer = await stripe.transfers.create({
      amount: Math.round(quote.amount * 100),
      currency: 'usd',
      destination: profile.stripe_account_id,
      metadata: { cashout_id: cashoutRow.id, user_id: user.id },
    })
    stripeTransferId = transfer.id

    if (method === 'instant') {
      // Stripe documents that instant payouts need an external account
      // marked as instant-eligible. If it isn't, this throws and we fall
      // back to the catch below — the funds will still ride out on the
      // default daily schedule, so we report success but warn the user.
      try {
        const payout = await stripe.payouts.create(
          {
            amount: Math.round(quote.amount * 100),
            currency: 'usd',
            method: 'instant',
            metadata: { cashout_id: cashoutRow.id, user_id: user.id },
          },
          { stripeAccount: profile.stripe_account_id },
        )
        stripePayoutId = payout.id
      } catch (instantErr) {
        // Don't unwind: the transfer succeeded. The Express account will
        // pay out on its default schedule (1-2 business days). Flag in
        // the admin notes / failure_reason and return a soft warning.
        console.error('cashout: instant payout failed, falling back to standard', instantErr)
        await admin
          .from('cashouts')
          .update({
            method: 'standard',
            fee: 0,
            total_debited: quote.amount,
            failure_reason: 'Instant payout unavailable; switched to standard',
          })
          .eq('id', cashoutRow.id)
        // Refund the $1 fee since we couldn't deliver instant.
        if (quote.fee > 0) {
          const { data: refundProfile } = await admin
            .from('profiles')
            .select('balance')
            .eq('id', user.id)
            .single()
          await admin
            .from('profiles')
            .update({ balance: Number(refundProfile?.balance || 0) + quote.fee })
            .eq('id', user.id)
          await admin.from('credit_transactions').insert({
            user_id: user.id,
            amount: quote.fee,
            type: 'refund_credit',
            description: 'Refund of instant payout fee — fell back to standard',
            metadata: { cashout_id: cashoutRow.id },
          })
        }
      }
    }

    await admin
      .from('cashouts')
      .update({
        stripe_transfer_id: stripeTransferId,
        ...(stripePayoutId ? { stripe_payout_id: stripePayoutId } : {}),
      })
      .eq('id', cashoutRow.id)
  } catch (transferErr) {
    console.error('cashout: transfer failed, rolling back', transferErr)
    // Restore balance + write a refund_credit ledger row + mark cashout failed.
    const { data: cur } = await admin
      .from('profiles')
      .select('balance')
      .eq('id', user.id)
      .single()
    await admin
      .from('profiles')
      .update({ balance: Number(cur?.balance || 0) + quote.totalDebited })
      .eq('id', user.id)
    await admin.from('credit_transactions').insert({
      user_id: user.id,
      amount: quote.totalDebited,
      type: 'refund_credit',
      description: 'Cashout reversed — Stripe transfer failed',
      metadata: { cashout_id: cashoutRow.id },
    })
    await admin
      .from('cashouts')
      .update({
        status: 'failed',
        failure_reason: transferErr instanceof Error ? transferErr.message : 'transfer failed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', cashoutRow.id)
    return NextResponse.json(
      { error: 'Bank transfer failed; your balance has been restored.' },
      { status: 502 },
    )
  }

  return NextResponse.json({
    success: true,
    cashout: {
      id: cashoutRow.id,
      amount: quote.amount,
      fee: quote.fee,
      total_debited: quote.totalDebited,
      method,
      status: 'pending',
    },
  })
}
