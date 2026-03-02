import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check admin
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const search = searchParams.get('search')
  const page = Number(searchParams.get('page') || '1')
  const limit = Number(searchParams.get('limit') || '20')
  const offset = (page - 1) * limit

  let query = supabase
    .from('orders')
    .select('*, buyer:profiles!orders_buyer_id_fkey(display_name, username, email:id), seller:profiles!orders_seller_id_fkey(display_name, username)', { count: 'exact' })

  if (status) {
    query = query.eq('status', status)
  }

  if (search) {
    query = query.ilike('id', `%${search}%`)
  }

  query = query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  const { data: orders, count, error } = await query

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 })
  }

  // Fetch items for each order
  const orderIds = (orders || []).map(o => o.id)
  const { data: allItems } = await supabase
    .from('order_items')
    .select('*')
    .in('order_id', orderIds)

  const ordersWithItems = (orders || []).map(order => ({
    ...order,
    items: (allItems || []).filter(item => item.order_id === order.id),
  }))

  return NextResponse.json({
    orders: ordersWithItems,
    total: count || 0,
    page,
    limit,
  })
}
