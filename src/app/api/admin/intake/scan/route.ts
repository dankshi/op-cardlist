import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
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

  const { searchParams } = new URL(request.url)
  const orderId = searchParams.get('orderId')

  if (!orderId) {
    return NextResponse.json({ error: 'orderId is required' }, { status: 400 })
  }

  // Support both full UUID and partial match (first 8 chars from QR scan)
  let orders: Record<string, unknown>[] | null = null
  let error: unknown = null

  if (orderId.length < 36) {
    // PostgREST can't ilike on UUID columns, so use a raw text match via RPC workaround
    const { data, error: err } = await supabase
      .from('orders')
      .select('*, buyer:profiles!orders_buyer_id_fkey(id, display_name, username), seller:profiles!orders_seller_id_fkey(id, display_name, username)')
      .or(`id.eq.${orderId}`)
      .limit(5)

    // If exact match fails (short id), try fetching all recent and filtering client-side
    if (!data?.length) {
      const { data: recent, error: recentErr } = await supabase
        .from('orders')
        .select('*, buyer:profiles!orders_buyer_id_fkey(id, display_name, username), seller:profiles!orders_seller_id_fkey(id, display_name, username)')
        .order('created_at', { ascending: false })
        .limit(100)

      error = recentErr
      orders = (recent || []).filter(o => (o.id as string).startsWith(orderId))
    } else {
      orders = data
    }
  } else {
    const { data, error: err } = await supabase
      .from('orders')
      .select('*, buyer:profiles!orders_buyer_id_fkey(id, display_name, username), seller:profiles!orders_seller_id_fkey(id, display_name, username)')
      .eq('id', orderId)
      .limit(5)
    orders = data
    error = err
  }

  if (error) {
    console.error('Scan error:', error)
    return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 })
  }

  if (!orders || orders.length === 0) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  // Fetch items with intake status for each order
  const orderIds = orders.map(o => o.id)
  const { data: items } = await supabase
    .from('order_items')
    .select('*')
    .in('order_id', orderIds)
    .order('created_at', { ascending: true })

  // Fetch open issues for these orders
  const { data: issues } = await supabase
    .from('intake_issues')
    .select('*')
    .in('order_id', orderIds)
    .order('created_at', { ascending: false })

  // Fetch recent activity log
  const { data: activityLog } = await supabase
    .from('intake_activity_log')
    .select('*')
    .in('order_id', orderIds)
    .order('created_at', { ascending: false })
    .limit(50)

  const ordersWithDetails = orders.map(order => ({
    ...order,
    items: (items || []).filter(item => item.order_id === order.id),
    intake_issues: (issues || []).filter(issue => issue.order_id === order.id),
    activity_log: (activityLog || []).filter(log => log.order_id === order.id),
  }))

  return NextResponse.json({
    orders: ordersWithDetails,
    count: ordersWithDetails.length,
  })
}
