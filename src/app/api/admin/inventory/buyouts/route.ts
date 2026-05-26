import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

/** Admin-only list endpoint for buyouts. Powers the /admin/inventory
 *  page's Buyouts tab. Pending claims first, then filed-but-not-paid,
 *  then resolved.
 *
 *  Optional ?claim_status filter narrows to one of the claim states
 *  (pending / filed / paid / denied). */
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
  const claimStatusFilter = url.searchParams.get('claim_status') || ''

  const admin = getSupabaseAdmin()
  let query = admin
    .from('buyouts')
    .select(`
      id,
      amount,
      reason,
      carrier_claim_id,
      carrier_claim_status,
      recovered_amount,
      notes,
      created_at,
      recovered_at,
      order_item:order_items!buyouts_order_item_id_fkey(
        id,
        card_id,
        card_name,
        condition,
        order_id
      ),
      seller:profiles!buyouts_seller_id_fkey(
        id,
        display_name,
        username
      )
    `)
    .order('created_at', { ascending: false })
    .limit(200)

  if (claimStatusFilter) {
    query = query.eq('carrier_claim_status', claimStatusFilter)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, rows: data || [] })
}
