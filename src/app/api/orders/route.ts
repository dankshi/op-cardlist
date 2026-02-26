import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const role = searchParams.get('role') || 'buyer' // 'buyer' or 'seller'
  const status = searchParams.get('status')

  let query = supabase
    .from('orders')
    .select(`
      *,
      buyer:profiles!orders_buyer_id_fkey(id, username, display_name, avatar_url),
      seller:profiles!orders_seller_id_fkey(id, username, display_name, avatar_url),
      items:order_items(*)
    `)

  if (role === 'seller') {
    query = query.eq('seller_id', user.id)
  } else {
    query = query.eq('buyer_id', user.id)
  }

  if (status) {
    query = query.eq('status', status)
  }

  query = query.order('created_at', { ascending: false })

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ orders: data })
}
