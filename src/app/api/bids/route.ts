import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const cardId = searchParams.get('card_id')
  const userId = searchParams.get('user_id')
  const limit = Math.min(Number(searchParams.get('limit') || 20), 50)

  const supabase = await createClient()

  let query = supabase
    .from('bids')
    .select('*, user:profiles(id, username, display_name, avatar_url, rating_avg)', { count: 'exact' })
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())

  if (cardId) query = query.eq('card_id', cardId)
  if (userId) query = query.eq('user_id', userId)

  query = query.order('price', { ascending: false }).limit(limit)

  const { data, error, count } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ bids: data, total: count })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { card_id, price, quantity } = body

  if (!card_id || !price || price <= 0) {
    return NextResponse.json({ error: 'card_id and a positive price are required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('bids')
    .insert({
      user_id: user.id,
      card_id,
      price,
      quantity: quantity || 1,
      condition_min: 'near_mint',
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const bidId = searchParams.get('id')

  if (!bidId) {
    return NextResponse.json({ error: 'Missing bid id' }, { status: 400 })
  }

  const { error } = await supabase
    .from('bids')
    .update({ status: 'cancelled' })
    .eq('id', bidId)
    .eq('user_id', user.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
