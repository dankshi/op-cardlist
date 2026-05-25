import { NextResponse } from 'next/server'
import { randomInt } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

/** Draw a winner uniformly at random from all entries on the raffle.
 *
 *  Pulls entry IDs in batches and picks an index with crypto.randomInt
 *  rather than ORDER BY random() in SQL — this keeps the logic in app
 *  code (testable, auditable) and avoids the Supabase JS builder's
 *  lack of a clean random-sort. Scales fine for v1 entry counts. If we
 *  ever need to draw across millions of entries, swap in a single
 *  Postgres RPC.
 *
 *  Atomicity: we flip status active→drawn with a status='active'
 *  precondition on the UPDATE so two concurrent draw requests can't
 *  both succeed. The losing request gets 'Raffle is not active'. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ raffleId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { raffleId } = await params
  const admin = getSupabaseAdmin()

  const { data: raffle } = await admin
    .from('raffles')
    .select('id, status')
    .eq('id', raffleId)
    .maybeSingle()

  if (!raffle) {
    return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
  }
  if (raffle.status !== 'active') {
    return NextResponse.json({ error: 'Raffle is not active' }, { status: 409 })
  }

  // Pull all entry IDs + user IDs. v1 expected scale is well under 10k.
  const { data: entries, error: entriesErr } = await admin
    .from('raffle_entries')
    .select('id, user_id')
    .eq('raffle_id', raffleId)
    .returns<{ id: string; user_id: string }[]>()

  if (entriesErr) {
    console.error('[admin/raffles/draw] entries fetch failed', entriesErr)
    return NextResponse.json({ error: 'Could not fetch entries' }, { status: 500 })
  }
  if (!entries || entries.length === 0) {
    return NextResponse.json({ error: 'No entries to draw from' }, { status: 400 })
  }

  // Uniform random pick using crypto-grade RNG.
  const winningIndex = randomInt(0, entries.length)
  const winning = entries[winningIndex]

  // Atomic transition: only succeed if the raffle is still active.
  const { data: updated, error: updateErr } = await admin
    .from('raffles')
    .update({
      status: 'drawn',
      winner_user_id: winning.user_id,
      drawn_at: new Date().toISOString(),
    })
    .eq('id', raffleId)
    .eq('status', 'active')
    .select('id')
    .maybeSingle()

  if (updateErr) {
    console.error('[admin/raffles/draw] update failed', updateErr)
    return NextResponse.json({ error: 'Draw failed to persist' }, { status: 500 })
  }
  if (!updated) {
    return NextResponse.json({ error: 'Raffle is no longer active' }, { status: 409 })
  }

  return NextResponse.json({
    ok: true,
    winner_user_id: winning.user_id,
    winning_entry_id: winning.id,
    total_entries: entries.length,
  })
}
