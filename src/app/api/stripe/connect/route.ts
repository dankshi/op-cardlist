import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/stripe'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_account_id, is_seller, seller_approved')
    .eq('id', user.id)
    .single()

  if (!profile?.is_seller || !profile?.seller_approved) {
    return NextResponse.json({ error: 'Not a verified seller' }, { status: 403 })
  }

  let accountId = profile.stripe_account_id

  // Create new Stripe Connect account if needed
  if (!accountId) {
    const account = await getStripe().accounts.create({
      type: 'express',
      email: user.email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    })
    accountId = account.id

    await supabase
      .from('profiles')
      .update({ stripe_account_id: accountId })
      .eq('id', user.id)
  }

  // Create onboarding link
  const origin = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
  const accountLink = await getStripe().accountLinks.create({
    account: accountId,
    refresh_url: `${origin}/seller/onboarding/complete?refresh=true`,
    return_url: `${origin}/seller/onboarding/complete`,
    type: 'account_onboarding',
  })

  return NextResponse.json({ url: accountLink.url })
}
