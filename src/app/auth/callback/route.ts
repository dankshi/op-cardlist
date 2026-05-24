import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { extractClientIp } from '@/lib/risk'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Stamp last_login_ip + last_seen_at on the profile. Used by
      // src/lib/risk.ts::evaluateOrderRisk to detect same-IP self-dealing
      // at order creation (buyer's current IP vs seller's last known IP).
      // Best-effort — never block sign-in on a profile-update failure.
      const userId = data?.user?.id
      if (userId) {
        const ip = extractClientIp(request)
        try {
          await supabase
            .from('profiles')
            .update({
              ...(ip ? { last_login_ip: ip } : {}),
              last_seen_at: new Date().toISOString(),
            })
            .eq('id', userId)
        } catch (err) {
          console.error('[auth/callback] failed to update last_login_ip:', err)
        }
      }
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/auth/sign-in?error=auth_failed`)
}
