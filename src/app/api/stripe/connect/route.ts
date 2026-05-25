import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/stripe'

// Stripe Connect Express onboarding. Used by two flows:
//   - Seller onboarding (from /sell + /seller pages) — needs to receive
//     marketplace payouts when their cards sell + authenticate.
//   - Wallet cashout (from /wallet) — any user with a non-zero credit balance
//     can connect a bank account to withdraw to.
// We create one Express account per user (idempotent on profiles.stripe_account_id)
// and only request the `transfers` capability. card_payments isn't requested
// because all buyer payments go to the platform Stripe account, not the
// connected account — see payment-intent/route.ts which doesn't set
// transfer_data or on_behalf_of.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_account_id, is_seller, seller_approved, balance')
    .eq('id', user.id)
    .single()

  // Allow if approved seller OR has a balance to cash out. Blocks random
  // logged-in users from triggering Stripe KYC noise with $0 balances.
  const balance = Number(profile?.balance || 0)
  const isApprovedSeller = profile?.is_seller && profile?.seller_approved
  if (!isApprovedSeller && balance <= 0) {
    return NextResponse.json(
      { error: 'No balance to cash out and not a verified seller' },
      { status: 403 },
    )
  }

  // The return-url branch matches who's onboarding. Sellers come from the
  // seller flow and land on the seller "complete" page; wallet-only users
  // pass ?intent=wallet and land on the wallet complete page.
  let intent: 'seller' | 'wallet' = isApprovedSeller ? 'seller' : 'wallet'
  try {
    const body = await request.json().catch(() => ({}))
    if (body?.intent === 'wallet' || body?.intent === 'seller') {
      intent = body.intent
    }
  } catch { /* no body — fine */ }

  let accountId = profile?.stripe_account_id

  if (!accountId) {
    const account = await getStripe().accounts.create({
      type: 'express',
      email: user.email,
      capabilities: {
        transfers: { requested: true },
      },
    })
    accountId = account.id

    await supabase
      .from('profiles')
      .update({ stripe_account_id: accountId })
      .eq('id', user.id)
  }

  // Prefer the actual request origin so localhost dev returns to localhost,
  // not the prod NEXT_PUBLIC_SITE_URL. The env var is the fallback for cases
  // where the request URL isn't a usable public URL (e.g. server-side calls).
  const origin = new URL(request.url).origin || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
  const returnBase = intent === 'wallet'
    ? `${origin}/wallet/onboarding/complete`
    : `${origin}/seller/onboarding/complete`

  const accountLink = await getStripe().accountLinks.create({
    account: accountId,
    refresh_url: `${returnBase}?refresh=true`,
    return_url: returnBase,
    type: 'account_onboarding',
  })

  return NextResponse.json({ url: accountLink.url })
}
