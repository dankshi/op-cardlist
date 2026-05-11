// One-off correction: credit back the $5 shipping label fee for accounts that
// were debited under the old "deduct at label generation" flow. The fee is now
// taken at authentication instead, so any pre-deferral debit needs reversing.
//
// Usage:  npx tsx scripts/fix-shipping-fee-credit.ts <email>

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

async function main() {
  const email = process.argv[2]
  if (!email) {
    console.error('Usage: npx tsx scripts/fix-shipping-fee-credit.ts <email>')
    process.exit(1)
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
    process.exit(1)
  }

  const supabase = createClient(url, serviceKey)

  const { data: list, error: listError } = await supabase.auth.admin.listUsers()
  if (listError) throw listError

  const user = list.users.find(u => u.email === email)
  if (!user) {
    console.error(`No user found with email ${email}`)
    process.exit(1)
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('balance')
    .eq('id', user.id)
    .single()
  if (profileError) throw profileError
  if (!profile) {
    console.error('Profile not found')
    process.exit(1)
  }

  const before = Number(profile.balance)
  const after = before + 5

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ balance: after })
    .eq('id', user.id)
  if (updateError) throw updateError

  const { error: ledgerError } = await supabase
    .from('credit_transactions')
    .insert({
      user_id: user.id,
      amount: 5,
      type: 'admin_adjust',
      description: 'Reversal of pre-deferral shipping label fee — fee now charged at authentication',
    })
  if (ledgerError) throw ledgerError

  console.log(`${email}: balance ${before.toFixed(2)} → ${after.toFixed(2)}`)
  console.log('Logged admin_adjust +$5 ledger row.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
