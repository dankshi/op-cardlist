import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { getStripe } from '@/lib/stripe'

// Reports whether the current user has a Stripe Connect Express account
// and whether it's payouts-enabled. We ask Stripe directly rather than
// trusting the cached profiles.stripe_onboarding_complete flag — the
// account.updated webhook is the source of truth but in-flight users may
// hit this page before the webhook lands. As a side-effect, we sync the
// cached flag with whatever Stripe says so other pages stay accurate.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_account_id, stripe_onboarding_complete')
    .eq('id', user.id)
    .single()

  if (!profile?.stripe_account_id) {
    return NextResponse.json({
      connected: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
    })
  }

  let account: Awaited<ReturnType<ReturnType<typeof getStripe>['accounts']['retrieve']>>
  try {
    account = await getStripe().accounts.retrieve(profile.stripe_account_id)
  } catch (err) {
    console.error('Failed to fetch Stripe account:', err)
    // Fall back to the cached flag so the UI isn't blocked on a Stripe outage.
    return NextResponse.json({
      connected: true,
      payoutsEnabled: profile.stripe_onboarding_complete,
      detailsSubmitted: profile.stripe_onboarding_complete,
    })
  }

  const payoutsEnabled = !!account.payouts_enabled
  const detailsSubmitted = !!account.details_submitted
  const onboardingComplete = payoutsEnabled && detailsSubmitted

  // Sync the cached flag if it drifted. Use service role because RLS
  // allows users to read their own profile but not update arbitrary fields.
  if (profile.stripe_onboarding_complete !== onboardingComplete) {
    const admin = getSupabaseAdmin()
    await admin
      .from('profiles')
      .update({ stripe_onboarding_complete: onboardingComplete })
      .eq('id', user.id)
  }

  return NextResponse.json({
    connected: true,
    payoutsEnabled,
    detailsSubmitted,
  })
}
