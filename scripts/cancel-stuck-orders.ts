/**
 * Cancel orders that have been stuck in `pending_payment` because their
 * Stripe webhook never reached local dev (no `stripe listen` running at
 * the time, or no tunnel configured). Test mode or live mode — webhooks
 * are an HTTP delivery to your server, and Stripe can't reach localhost.
 *
 * Dry-run by default. Pass --go to actually update.
 */
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function main() {
  const { data: stuck, error } = await supabase
    .from('orders')
    .select('id, total, created_at, stripe_payment_intent_id')
    .eq('status', 'pending_payment')

  if (error) {
    console.error(error)
    return
  }

  console.log(`\nFound ${stuck?.length ?? 0} stuck pending_payment orders:\n`)
  for (const o of stuck ?? []) {
    console.log(`  #${o.id.slice(0, 8)}  $${o.total}  created=${o.created_at?.slice(0, 10)}  pi=${o.stripe_payment_intent_id || '(none)'}`)
  }

  if (process.argv[2] !== '--go') {
    console.log('\nDry-run. Re-run with --go to cancel them.')
    return
  }

  const ids = (stuck ?? []).map(o => o.id)
  if (ids.length === 0) return

  const { error: updErr } = await supabase
    .from('orders')
    .update({ status: 'cancelled' })
    .in('id', ids)

  if (updErr) {
    console.error('Update failed:', updErr)
    return
  }

  console.log(`\n✓ Cancelled ${ids.length} order(s).`)
}

main().catch(console.error)
