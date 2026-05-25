import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

/** Claim the user's one-and-only free entry on the given raffle.
 *  Auth-gated. Idempotency comes from the partial unique index
 *  `uniq_raffle_signup`; a second claim returns 409 from the
 *  unique-violation code. */
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json(
      { error: 'Sign in to claim your entry' },
      { status: 401 },
    )
  }

  const body = await req.json().catch(() => ({})) as { raffleId?: string }
  if (!body.raffleId) {
    return NextResponse.json({ error: 'Missing raffleId' }, { status: 400 })
  }

  const { data: raffle } = await supabase
    .from('raffles')
    .select('id, status')
    .eq('id', body.raffleId)
    .maybeSingle()

  if (!raffle || raffle.status !== 'active') {
    return NextResponse.json(
      { error: 'This raffle is not currently accepting entries' },
      { status: 400 },
    )
  }

  const admin = getSupabaseAdmin()
  const { error } = await admin.from('raffle_entries').insert({
    raffle_id: raffle.id,
    user_id: user.id,
    source: 'signup',
  })

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'You already claimed your free entry for this raffle.' },
        { status: 409 },
      )
    }
    console.error('[raffles/free-entry] insert failed', error)
    return NextResponse.json({ error: 'Failed to claim entry' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
