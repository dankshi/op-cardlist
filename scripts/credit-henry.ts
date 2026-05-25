/**
 * One-off: credit $100 to henry's wallet for testing cashout.
 * Writes an admin_adjust ledger row + bumps profiles.balance to match.
 * Service-role only (this script bypasses RLS).
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing')

const sb = createClient(url, key)

async function main() {
  // Look up by display_name='henry'. Auth-lookup by email and
  // username-lookup both returned empty in this environment; display_name
  // is the only stable handle on the row.
  const { data: profile } = await sb
    .from('profiles')
    .select('id, username, display_name')
    .eq('display_name', 'henry')
    .maybeSingle()

  const userId: string | null = profile?.id ?? null

  if (!userId) {
    console.error('Could not find profile with display_name=henry')
    process.exit(1)
  }

  // Get current balance + display name for confirmation
  const { data: before } = await sb
    .from('profiles')
    .select('id, username, display_name, balance')
    .eq('id', userId)
    .single()
  if (!before) {
    console.error('Profile row not found for user id', userId)
    process.exit(1)
  }
  console.log(`Profile: ${before.username || before.display_name || '(unnamed)'}  current balance: $${Number(before.balance).toFixed(2)}`)

  const AMOUNT = 100

  // Insert the canonical ledger row first
  const { data: txn, error: txnErr } = await sb
    .from('credit_transactions')
    .insert({
      user_id: userId,
      amount: AMOUNT,
      type: 'admin_adjust',
      description: 'Test credit for cashout QA',
      metadata: { source: 'scripts/credit-henry.ts', date: new Date().toISOString() },
    })
    .select()
    .single()

  if (txnErr || !txn) {
    console.error('Failed to insert credit transaction:', txnErr)
    process.exit(1)
  }
  console.log(`Inserted credit_transactions row: ${txn.id}`)

  // Bump profiles.balance
  const { data: after, error: balErr } = await sb
    .from('profiles')
    .update({ balance: Number(before.balance) + AMOUNT })
    .eq('id', userId)
    .select('balance')
    .single()

  if (balErr || !after) {
    console.error('Failed to update profile balance. Ledger row was written though — manual cleanup may be needed.')
    console.error(balErr)
    process.exit(1)
  }
  console.log(`New balance: $${Number(after.balance).toFixed(2)}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
