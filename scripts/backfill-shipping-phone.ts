/**
 * One-shot backfill: add a placeholder phone number to any orders
 * whose shipping_address JSON is missing one. USPS rejects outbound
 * label generation without it.
 *
 * Run with: npx tsx scripts/backfill-shipping-phone.ts
 *
 * Idempotent — orders that already have a phone are left alone.
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const PLACEHOLDER_PHONE = '5555550199' // 555-555-0199 — reserved range, never dialable

async function main() {
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!)

  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, shipping_address')
    .not('shipping_address', 'is', null)

  if (error) {
    console.error('Failed to fetch orders:', error)
    process.exit(1)
  }

  let updated = 0
  let skipped = 0
  for (const order of orders || []) {
    const addr = order.shipping_address as Record<string, unknown> | null
    if (!addr) continue
    if (addr.phone) {
      skipped++
      continue
    }
    const { error: updateErr } = await supabase
      .from('orders')
      .update({ shipping_address: { ...addr, phone: PLACEHOLDER_PHONE } })
      .eq('id', order.id)
    if (updateErr) {
      console.error(`Failed to update ${order.id}:`, updateErr)
      continue
    }
    updated++
  }

  console.log(`Backfilled phone on ${updated} order(s). Skipped ${skipped} that already had one.`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
