import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const ALLOWED_GRADERS = new Set(['PSA', 'CGC', 'BGS', 'TAG'])

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const cardId = searchParams.get('card_id')
  const userId = searchParams.get('user_id')
  // Optional variant filter: ?grading_company=PSA&grade=10 returns only
  // bids on that specific slab. ?grading_company=null (string "null")
  // returns only raw bids. Omitting both returns every variant.
  const gradingCompany = searchParams.get('grading_company')
  const grade = searchParams.get('grade')
  const limit = Math.min(Number(searchParams.get('limit') || 20), 50)

  const supabase = await createClient()

  let query = supabase
    .from('bids')
    .select('*, user:profiles(id, username, display_name, avatar_url, rating_avg)', { count: 'exact' })
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())

  if (cardId) query = query.eq('card_id', cardId)
  if (userId) query = query.eq('user_id', userId)
  if (gradingCompany === 'null') {
    query = query.is('grading_company', null)
  } else if (gradingCompany) {
    query = query.eq('grading_company', gradingCompany)
    if (grade) query = query.eq('grade', grade)
  }

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
  const { card_id, price, quantity, grading_company, grade } = body

  if (!card_id || !price || price <= 0) {
    return NextResponse.json({ error: 'card_id and a positive price are required' }, { status: 400 })
  }

  // Graded bids: both grading_company and grade must be set together.
  // Either-or is rejected at the DB layer too (CHECK constraint added in
  // migration 20260539), but we validate here so the client gets a clean
  // 400 instead of a generic 500.
  const hasCompany = grading_company != null && grading_company !== ''
  const hasGrade = grade != null && grade !== ''
  if (hasCompany !== hasGrade) {
    return NextResponse.json(
      { error: 'grading_company and grade must be provided together (or both omitted for a raw offer)' },
      { status: 400 },
    )
  }
  if (hasCompany && !ALLOWED_GRADERS.has(grading_company)) {
    return NextResponse.json(
      { error: `grading_company must be one of ${[...ALLOWED_GRADERS].join(', ')}` },
      { status: 400 },
    )
  }

  const { data, error } = await supabase
    .from('bids')
    .insert({
      user_id: user.id,
      card_id,
      price,
      quantity: quantity || 1,
      condition_min: 'near_mint',
      grading_company: hasCompany ? grading_company : null,
      grade: hasGrade ? grade : null,
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
