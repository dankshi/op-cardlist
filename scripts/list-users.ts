import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
  const { data: page } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 })
  console.log(`auth.users (${page.users.length}):`)
  for (const u of page.users) {
    console.log(`  ${u.id}  ${u.email ?? '(no email)'}  created=${u.created_at?.slice(0, 10)}`)
  }

  const { data: profiles } = await sb
    .from('profiles')
    .select('id, username, display_name, is_admin, balance, created_at')
    .order('created_at', { ascending: false })
  console.log(`\nprofiles (${profiles?.length ?? 0}):`)
  for (const p of profiles ?? []) {
    console.log(`  ${p.id}  user=${p.username || '-'}  name=${p.display_name || '-'}  admin=${p.is_admin}  balance=$${Number(p.balance).toFixed(2)}`)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
