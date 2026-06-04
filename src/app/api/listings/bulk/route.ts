import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const ALLOWED_GRADERS = new Set(['PSA', 'CGC', 'BGS', 'TAG'])

/** POST /api/listings/bulk
 *
 *  Create many listings in one request — backs the Seller Hub "Add
 *  Listings" tab (both the multi-row table and the CSV/paste import).
 *  Mirrors the single-listing validation in ../route.ts but validates
 *  every row and inserts the valid ones in one shot, returning a
 *  per-row error report so the client can show partial success.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_seller, seller_approved')
    .eq('id', user.id)
    .single()

  if (!profile?.is_seller || !profile?.seller_approved) {
    return NextResponse.json({ error: 'Not a verified seller' }, { status: 403 })
  }

  const body = await request.json()
  const rows = Array.isArray(body?.rows) ? body.rows : null
  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: 'rows must be a non-empty array' }, { status: 400 })
  }
  if (rows.length > 200) {
    return NextResponse.json({ error: 'Too many rows (max 200 per request)' }, { status: 400 })
  }

  const errors: { row: number; message: string }[] = []
  const valid: Record<string, unknown>[] = []

  rows.forEach((raw: Record<string, unknown>, i: number) => {
    const card_id = typeof raw.card_id === 'string' ? raw.card_id.trim() : ''
    const title = typeof raw.title === 'string' ? raw.title.trim() : ''
    const price = Number(raw.price)
    const quantity = raw.quantity == null ? 1 : Math.floor(Number(raw.quantity))
    const language = typeof raw.language === 'string' && raw.language ? raw.language : 'EN'
    const gradingCompany = raw.grading_company == null || raw.grading_company === ''
      ? null
      : String(raw.grading_company).toUpperCase()
    const grade = raw.grade == null || raw.grade === '' ? null : String(raw.grade)

    if (!card_id) { errors.push({ row: i, message: 'Missing card_id' }); return }
    if (!Number.isFinite(price) || price <= 0) { errors.push({ row: i, message: 'Price must be greater than 0' }); return }
    if (!Number.isFinite(quantity) || quantity < 1) { errors.push({ row: i, message: 'Quantity must be at least 1' }); return }
    // Grading is all-or-nothing — both company and grade, or neither
    // (raw NM). Matches the bids CHECK constraint + /api/listings.
    if ((gradingCompany == null) !== (grade == null)) {
      errors.push({ row: i, message: 'grading_company and grade must be set together (or both empty for raw)' })
      return
    }
    if (gradingCompany != null && !ALLOWED_GRADERS.has(gradingCompany)) {
      errors.push({ row: i, message: `grading_company must be one of ${[...ALLOWED_GRADERS].join(', ')}` })
      return
    }

    valid.push({
      seller_id: user.id,
      card_id,
      // Title defaults to the card_id when the client didn't resolve a
      // name (e.g. a CSV row) — keeps the NOT NULL column satisfied.
      title: title || card_id,
      condition: 'near_mint',
      price,
      quantity,
      quantity_available: quantity,
      language,
      grading_company: gradingCompany,
      grade,
      photo_urls: [],
    })
  })

  let created: unknown[] = []
  if (valid.length > 0) {
    const { data, error } = await supabase.from('listings').insert(valid).select()
    if (error) {
      return NextResponse.json({ error: error.message, errors }, { status: 500 })
    }
    created = data || []
  }

  return NextResponse.json({ created, errors }, { status: errors.length && !created.length ? 400 : 201 })
}
