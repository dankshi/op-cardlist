import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

// Admin-gated, service-role read of EVERYTHING attached to an order — the
// "master view" data layer. We use the service-role client (after the
// admin gate) because several related tables (credit_transactions,
// buyouts, intake_activity_log) aren't RLS-visible to the browser anon
// client. Queries run in parallel rather than as one giant nested select,
// which is easier to maintain and sidesteps RLS-join surprises.

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401 as const }
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  if (!profile?.is_admin) return { error: 'Forbidden', status: 403 as const }
  return { user }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const gate = await requireAdmin()
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status })
  }

  const { orderId } = await params
  const db = getSupabaseAdmin()

  // Order + parties, and the items, first — items' ids/listing_ids feed
  // the per-item related queries below.
  const [{ data: order, error: orderErr }, { data: items }] = await Promise.all([
    db
      .from('orders')
      .select('*, buyer:profiles!orders_buyer_id_fkey(*), seller:profiles!orders_seller_id_fkey(*)')
      .eq('id', orderId)
      .single(),
    db.from('order_items').select('*').eq('order_id', orderId).order('created_at', { ascending: true }),
  ])

  if (orderErr || !order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  const itemRows = items || []
  const itemIds = itemRows.map(i => i.id)
  const listingIds = [...new Set(itemRows.map(i => i.listing_id).filter(Boolean))]

  // Everything that hangs off the order or its items, in parallel.
  const [
    { data: listings },
    { data: intakeIssues },
    { data: activityLog },
    { data: consignments },
    { data: buyouts },
    { data: reviews },
    { data: creditTransactions },
  ] = await Promise.all([
    listingIds.length
      ? db.from('listings').select('*').in('id', listingIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    db.from('intake_issues').select('*').eq('order_id', orderId).order('created_at', { ascending: false }),
    db.from('intake_activity_log').select('*').eq('order_id', orderId).order('created_at', { ascending: false }),
    itemIds.length
      ? db.from('consignment_items').select('*').in('origin_order_item_id', itemIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    itemIds.length
      ? db.from('buyouts').select('*').in('order_item_id', itemIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    db.from('reviews').select('*').eq('order_id', orderId),
    db.from('credit_transactions').select('*').eq('order_id', orderId).order('created_at', { ascending: false }),
  ])

  return NextResponse.json({
    order,
    items: itemRows,
    listings: listings || [],
    intake_issues: intakeIssues || [],
    activity_log: activityLog || [],
    consignments: consignments || [],
    buyouts: buyouts || [],
    reviews: reviews || [],
    credit_transactions: creditTransactions || [],
  })
}
