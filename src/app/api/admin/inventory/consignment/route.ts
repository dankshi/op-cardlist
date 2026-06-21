import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

/** Admin-only list endpoint for exception-origin consignment items.
 *  Powers the /admin/inventory page's Consignment tab. Pending-first
 *  ordering so ops sees the items still needing a relist price at the top.
 *
 *  Scoped to channel='exception' — seller-initiated consignments have
 *  their own surface (/admin/consignments). Optional ?status filter
 *  narrows to one of the lifecycle states (confirmed / listed / sold /
 *  rejected). */
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(request.url)
  const statusFilter = url.searchParams.get('status') || ''

  const admin = getSupabaseAdmin()
  let query = admin
    .from('consignment_items')
    .select(`
      id,
      exception_type,
      ask_price,
      listing_id,
      status,
      notes,
      created_at,
      listed_at,
      resolved_at,
      submission:consignment_submissions!inner(channel),
      order_item:order_items!consignment_items_origin_order_item_id_fkey(
        id,
        card_id,
        card_name,
        condition,
        quantity,
        unit_price,
        order_id
      ),
      seller:profiles!consignment_items_seller_id_fkey(
        id,
        display_name,
        username
      )
    `)
    .eq('submission.channel', 'exception')
    .order('status', { ascending: true })  // confirmed sorts before listed/sold/rejected
    .order('created_at', { ascending: false })
    .limit(200)

  if (statusFilter) {
    query = query.eq('status', statusFilter)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, rows: data || [] })
}
