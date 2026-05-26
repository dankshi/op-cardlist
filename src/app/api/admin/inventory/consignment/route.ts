import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

/** Admin-only list endpoint for consigned_intakes. Powers the
 *  /admin/inventory page's Consignment tab. Pending-first ordering
 *  so ops sees the items still needing a relist price at the top.
 *
 *  Optional ?status filter narrows to one of the four lifecycle
 *  states (pending_relist / listed / sold / written_off). */
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
    .from('consigned_intakes')
    .select(`
      id,
      exception_type,
      intended_relist_price,
      consignment_listing_id,
      status,
      notes,
      consigned_at,
      listed_at,
      resolved_at,
      order_item:order_items!consigned_intakes_order_item_id_fkey(
        id,
        card_id,
        card_name,
        condition,
        quantity,
        unit_price,
        order_id
      ),
      seller:profiles!consigned_intakes_original_seller_id_fkey(
        id,
        display_name,
        username
      )
    `)
    .order('status', { ascending: true })  // pending_relist sorts before listed/sold/written_off
    .order('consigned_at', { ascending: false })
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
