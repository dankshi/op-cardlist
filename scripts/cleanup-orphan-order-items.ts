/**
 * Delete `order_items` rows whose `order_id` doesn't exist in `orders`.
 *
 * These showed up while debugging the /admin/intake name/image mismatch:
 * a batch of seeded fixture rows all share `listing_id =
 * d8eb7c23-052c-4220-aeb2-a1d4224bc161` and reference order_ids that
 * have no matching row in `orders`. They cannot be reached through the
 * normal app (the order is gone), but they pollute admin queries.
 *
 * Modes:
 *   pnpm tsx scripts/cleanup-orphan-order-items.ts        # dry-run
 *   pnpm tsx scripts/cleanup-orphan-order-items.ts --go   # delete
 *
 * Safety: an item is only deleted if its `order_id` returns *zero*
 * rows from `orders` (verified per-id, not via .in()). Items whose
 * parent order exists are left alone even if their card_name looks
 * inconsistent — that data could still belong to a real test order
 * someone is mid-flow on.
 */
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function findOrphans() {
  // Pull all order_items in pages — table should be small enough that
  // this is fine, but cap to avoid runaway if it isn't.
  const pageSize = 1000
  const allItems: Array<{ id: string; order_id: string; card_id: string; card_name: string; listing_id: string; created_at: string }> = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('order_items')
      .select('id, order_id, card_id, card_name, listing_id, created_at')
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    allItems.push(...data)
    if (data.length < pageSize) break
    from += pageSize
    if (allItems.length >= 50_000) {
      console.warn('  bail: more than 50k order_items; check pagination')
      break
    }
  }

  // Distinct order_ids → check each against orders.
  const orderIds = Array.from(new Set(allItems.map(i => i.order_id)))
  const missing = new Set<string>()
  for (const oid of orderIds) {
    const { data } = await supabase.from('orders').select('id').eq('id', oid).maybeSingle()
    if (!data) missing.add(oid)
  }

  return { allItems, orphans: allItems.filter(i => missing.has(i.order_id)), missingOrderIds: missing }
}

async function dryRun() {
  console.log('=== Scanning order_items for orphans ===\n')
  const { allItems, orphans, missingOrderIds } = await findOrphans()
  console.log(`  Total order_items scanned: ${allItems.length}`)
  console.log(`  Distinct missing order_ids: ${missingOrderIds.size}`)
  console.log(`  Orphan order_items to delete: ${orphans.length}\n`)

  if (orphans.length === 0) {
    console.log('  Nothing to clean up.')
    return { orphans }
  }

  // Group by missing order_id for readability.
  const byOrder = new Map<string, typeof orphans>()
  for (const o of orphans) {
    const list = byOrder.get(o.order_id) || []
    list.push(o)
    byOrder.set(o.order_id, list)
  }

  for (const [orderId, items] of byOrder) {
    console.log(`  order_id ${orderId.slice(0, 8)}... (missing) — ${items.length} item(s):`)
    for (const it of items) {
      console.log(`    - ${it.id.slice(0, 8)}  card_id=${(it.card_id || '').padEnd(16)}  name="${it.card_name}"`)
    }
  }

  console.log('\n  Re-run with --go to delete the orphans above.')
  return { orphans }
}

async function go() {
  const { orphans } = await dryRun()
  if (orphans.length === 0) return

  const ids = orphans.map(o => o.id)
  // Delete in chunks to keep the URL/payload sane.
  const chunkSize = 200
  let deleted = 0
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize)
    const { error, count } = await supabase
      .from('order_items')
      .delete({ count: 'exact' })
      .in('id', chunk)
    if (error) {
      console.error('\nDelete failed on chunk:', error)
      return
    }
    deleted += count ?? chunk.length
  }
  console.log(`\n✓ Deleted ${deleted} orphan order_items.`)
}

const arg = process.argv[2]
if (arg === '--go') {
  go().catch(e => { console.error(e); process.exit(1) })
} else {
  dryRun().catch(e => { console.error(e); process.exit(1) })
}
