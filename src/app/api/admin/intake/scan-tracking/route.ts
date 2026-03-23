import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { TrackingMatchType } from '@/types/database'

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
  const tracking = searchParams.get('tracking')?.trim()

  if (!tracking) {
    return NextResponse.json({ error: 'tracking is required' }, { status: 400 })
  }

  // Look up orders by seller_tracking_number
  const { data: orders, error } = await supabase
    .from('orders')
    .select('*, buyer:profiles!orders_buyer_id_fkey(id, display_name, username), seller:profiles!orders_seller_id_fkey(id, display_name, username)')
    .eq('seller_tracking_number', tracking)
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) {
    console.error('Tracking scan error:', error)
    return NextResponse.json({ error: 'Failed to search orders' }, { status: 500 })
  }

  if (!orders || orders.length === 0) {
    return NextResponse.json({ match: 'none' as TrackingMatchType, orders: [] })
  }

  // Classify the match
  // Active statuses: orders still in the pipeline waiting to be received
  const activeStatuses = ['paid', 'seller_shipped']
  const activeOrders = orders.filter(o => activeStatuses.includes(o.status))
  const completedOrders = orders.filter(o => !activeStatuses.includes(o.status))

  let match: TrackingMatchType
  let resultOrders = orders
  let sellerId: string | undefined

  if (activeOrders.length === 1 && completedOrders.length === 0) {
    // Happy path: exactly 1 active order with this tracking
    match = 'exact'
    resultOrders = activeOrders
  } else if (activeOrders.length > 1) {
    // Multiple active orders with same tracking — re-used label
    match = 'multiple'
    sellerId = orders[0].seller_id
  } else if (activeOrders.length === 1 && completedOrders.length > 0) {
    // 1 active + previous completed orders — still treat as exact (the active one is the valid one)
    match = 'exact'
    resultOrders = activeOrders
  } else if (activeOrders.length === 0 && completedOrders.length > 0) {
    // Only completed orders — this tracking was already used
    match = 'reused'
    sellerId = completedOrders[0].seller_id
  } else {
    match = 'none'
  }

  // Fetch items for result orders
  const orderIds = resultOrders.map(o => o.id)

  const { data: items } = await supabase
    .from('order_items')
    .select('*')
    .in('order_id', orderIds)
    .order('created_at', { ascending: true })

  const { data: issues } = await supabase
    .from('intake_issues')
    .select('*')
    .in('order_id', orderIds)
    .order('created_at', { ascending: false })

  const { data: activityLog } = await supabase
    .from('intake_activity_log')
    .select('*')
    .in('order_id', orderIds)
    .order('created_at', { ascending: false })
    .limit(50)

  const ordersWithDetails = resultOrders.map(order => ({
    ...order,
    items: (items || []).filter(item => item.order_id === order.id),
    intake_issues: (issues || []).filter(issue => issue.order_id === order.id),
    activity_log: (activityLog || []).filter(log => log.order_id === order.id),
  }))

  return NextResponse.json({
    match,
    orders: ordersWithDetails,
    seller_id: sellerId,
    count: ordersWithDetails.length,
  })
}
