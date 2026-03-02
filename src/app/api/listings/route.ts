import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const cardId = searchParams.get('card_id')
  const sellerId = searchParams.get('seller_id')
  const condition = searchParams.get('condition')
  const sort = searchParams.get('sort') || 'price_asc'
  const limit = Math.min(Number(searchParams.get('limit') || 50), 100)
  const offset = Number(searchParams.get('offset') || 0)

  const supabase = await createClient()

  let query = supabase
    .from('listings')
    .select('*, seller:profiles(id, username, display_name, avatar_url, rating_avg, rating_count)', { count: 'exact' })
    .eq('status', 'active')

  if (cardId) query = query.eq('card_id', cardId)
  if (sellerId) query = query.eq('seller_id', sellerId)
  if (condition) query = query.eq('condition', condition)

  if (sort === 'price_asc') query = query.order('price', { ascending: true })
  else if (sort === 'price_desc') query = query.order('price', { ascending: false })
  else if (sort === 'newest') query = query.order('created_at', { ascending: false })

  query = query.range(offset, offset + limit - 1)

  const { data, error, count } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ listings: data, total: count })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check seller status
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_seller, seller_approved')
    .eq('id', user.id)
    .single()

  if (!profile?.is_seller || !profile?.seller_approved) {
    return NextResponse.json({ error: 'Not a verified seller' }, { status: 403 })
  }

  const body = await request.json()
  const { card_id, title, description, price, quantity, language, is_first_edition, photo_urls, grading_company, grade } = body

  if (!card_id || !title || !price || price <= 0) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('listings')
    .insert({
      seller_id: user.id,
      card_id,
      title,
      description: description || null,
      condition: 'near_mint',
      price,
      quantity: quantity || 1,
      quantity_available: quantity || 1,
      language: language || 'EN',
      is_first_edition: is_first_edition || false,
      photo_urls: photo_urls || [],
      grading_company: grading_company || null,
      grade: grade || null,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
