import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

const GRADING_COMPANIES = new Set(['PSA', 'CGC', 'BGS', 'TAG'])

async function requireAdminUser(): Promise<{ userId: string } | NextResponse> {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { data: profile } = await authClient.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  return { userId: user.id }
}

function parseVariant(body: { card_id?: string; grading_company?: string; grade?: string }) {
  const cardId = body.card_id?.trim().toUpperCase()
  const company = body.grading_company?.trim().toUpperCase()
  const grade = body.grade?.trim()
  if (!cardId) return { error: 'card_id is required' as const }
  if (!company || !GRADING_COMPANIES.has(company)) return { error: `grading_company must be one of: ${[...GRADING_COMPANIES].join(', ')}` as const }
  if (!grade) return { error: 'grade is required' as const }
  return { cardId, company, grade }
}

/** POST /api/admin/slab-overrides — pin a market value for a variant.
 *  Body: { card_id, grading_company, grade, value, note? }
 *
 *  Overrides win over the computed comp at read time (getCardSlabValues /
 *  holdingMarketPrice), so no recompute is needed — just bust the card cache. */
export async function POST(req: NextRequest) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  let body: { card_id?: string; grading_company?: string; grade?: string; value?: number; note?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const v = parseVariant(body)
  if ('error' in v) return NextResponse.json({ error: v.error }, { status: 400 })
  const value = Number(body.value)
  if (!Number.isFinite(value) || value <= 0) return NextResponse.json({ error: 'value must be a positive number' }, { status: 400 })

  const admin = getSupabaseAdmin()
  const { error } = await admin.from('slab_value_overrides').upsert(
    {
      card_id: v.cardId,
      grading_company: v.company,
      grade: v.grade,
      value,
      note: body.note?.trim() || null,
      set_by: auth.userId,
      set_at: new Date().toISOString(),
    },
    { onConflict: 'card_id,grading_company,grade' },
  )
  if (error) {
    console.error('slab_value_overrides upsert failed:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  revalidatePath('/admin/price-sources')
  revalidatePath(`/card/${v.cardId.toLowerCase()}`)
  return NextResponse.json({ success: true })
}

/** DELETE /api/admin/slab-overrides — remove a pinned value.
 *  Body: { card_id, grading_company, grade } */
export async function DELETE(req: NextRequest) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  let body: { card_id?: string; grading_company?: string; grade?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const v = parseVariant(body)
  if ('error' in v) return NextResponse.json({ error: v.error }, { status: 400 })

  const admin = getSupabaseAdmin()
  const { error } = await admin
    .from('slab_value_overrides')
    .delete()
    .eq('card_id', v.cardId)
    .eq('grading_company', v.company)
    .eq('grade', v.grade)
  if (error) {
    console.error('slab_value_overrides delete failed:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  revalidatePath('/admin/price-sources')
  revalidatePath(`/card/${v.cardId.toLowerCase()}`)
  return NextResponse.json({ success: true })
}
