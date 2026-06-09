import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { recomputeSlabCards } from '@/lib/slab-comp-recompute'

const GRADING_COMPANIES = new Set(['PSA', 'CGC', 'BGS', 'TAG'])

/** Verify the caller is a signed-in admin. Returns the user id, or a
 *  NextResponse to short-circuit with on failure. */
async function requireAdminUser(): Promise<{ userId: string } | NextResponse> {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { data: profile } = await authClient.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  return { userId: user.id }
}

/** POST /api/admin/slab-sales
 *  Body: { card_id, grading_company, grade, price, sold_at, title?, listing_url? }
 *
 *  Hand-add a graded sale (source='admin') — for private deals, Discord sales,
 *  or auction results not on any feed. Recomputes the affected variant's comp
 *  immediately so the new sale shows up in pricing on the next render. */
export async function POST(req: NextRequest) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  let body: {
    card_id?: string
    grading_company?: string
    grade?: string
    price?: number
    sold_at?: string
    title?: string
    listing_url?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const cardId = body.card_id?.trim().toUpperCase()
  const company = body.grading_company?.trim().toUpperCase()
  const grade = body.grade?.trim()
  const price = Number(body.price)
  const soldAtRaw = body.sold_at

  if (!cardId) return NextResponse.json({ error: 'card_id is required' }, { status: 400 })
  if (!company || !GRADING_COMPANIES.has(company)) {
    return NextResponse.json({ error: `grading_company must be one of: ${[...GRADING_COMPANIES].join(', ')}` }, { status: 400 })
  }
  if (!grade) return NextResponse.json({ error: 'grade is required' }, { status: 400 })
  if (!Number.isFinite(price) || price <= 0) return NextResponse.json({ error: 'price must be a positive number' }, { status: 400 })
  const soldAt = soldAtRaw ? new Date(soldAtRaw) : null
  if (!soldAt || isNaN(soldAt.getTime())) return NextResponse.json({ error: 'sold_at must be a valid date' }, { status: 400 })

  // Don't let a fat-fingered card_id silently create a comp for a card that
  // doesn't exist.
  const admin = getSupabaseAdmin()
  const { data: card } = await admin.from('cards').select('id').eq('id', cardId).maybeSingle()
  if (!card) return NextResponse.json({ error: `No card with id ${cardId}` }, { status: 400 })

  const { data: inserted, error } = await admin
    .from('slab_sales')
    .insert({
      card_id: cardId,
      source: 'admin',
      grading_company: company,
      grade,
      sale_kind: 'sold',
      status: 'visible',
      sold_at: soldAt.toISOString(),
      price,
      title: body.title?.trim() || `Manual entry — ${company} ${grade}`,
      listing_url: body.listing_url?.trim() || null,
      parse_confidence: 'high',
      reviewed_by: auth.userId,
      reviewed_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (error) {
    console.error('slab_sales manual insert failed:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await recomputeSlabCards(admin, { cardIds: [cardId] })
  revalidatePath('/admin/slab-sales')
  revalidatePath(`/card/${cardId.toLowerCase()}`)

  return NextResponse.json({ success: true, id: inserted.id })
}
