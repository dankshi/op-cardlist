import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('cart_items')
    .select(`
      *,
      listing:listings(
        *,
        seller:profiles(id, username, display_name, avatar_url, rating_avg, rating_count, stripe_account_id)
      )
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ items: data })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { listing_id, quantity = 1 } = await request.json()

  if (!listing_id) {
    return NextResponse.json({ error: 'listing_id required' }, { status: 400 })
  }

  // Check stock
  const { data: listing } = await supabase
    .from('listings')
    .select('quantity_available, status')
    .eq('id', listing_id)
    .single()

  if (!listing || listing.status !== 'active') {
    return NextResponse.json({ error: 'Listing not available' }, { status: 404 })
  }

  if (quantity > listing.quantity_available) {
    return NextResponse.json({ error: 'Not enough stock' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('cart_items')
    .upsert({
      user_id: user.id,
      listing_id,
      quantity,
    }, { onConflict: 'user_id,listing_id' })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const itemId = searchParams.get('id')

  if (!itemId) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  const { error } = await supabase
    .from('cart_items')
    .delete()
    .eq('id', itemId)
    .eq('user_id', user.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
