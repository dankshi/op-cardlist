import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Manual collection CRUD. All operations run on the caller's own rows via the
// session client — the collections RLS policy (user_id = auth.uid()) scopes
// every read/write, and the add path reuses the same atomic increment RPC as
// purchase auto-adds so a manual add of a card you already own bumps quantity.

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const cardId = typeof body.card_id === 'string' ? body.card_id.trim() : ''
  const quantity = Math.max(1, Math.floor(Number(body.quantity) || 1))
  const acquiredPrice = body.acquired_price != null && body.acquired_price !== ''
    ? Number(body.acquired_price)
    : null
  const acquiredDate = typeof body.acquired_date === 'string' && body.acquired_date ? body.acquired_date : null
  const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null
  // Grade: both present = a slab; both absent = raw (near_mint).
  const gradingCompany = typeof body.grading_company === 'string' && body.grading_company ? body.grading_company : null
  const grade = typeof body.grade === 'string' && body.grade ? body.grade : null
  const isGraded = gradingCompany != null && grade != null

  if (!cardId) return NextResponse.json({ error: 'card_id is required' }, { status: 400 })
  if (acquiredPrice != null && (!Number.isFinite(acquiredPrice) || acquiredPrice < 0)) {
    return NextResponse.json({ error: 'Invalid acquired price' }, { status: 400 })
  }

  const { data: row, error } = await supabase.rpc('upsert_collection_increment', {
    p_card_id: cardId,
    p_condition: isGraded ? null : 'near_mint',
    p_quantity: quantity,
    p_acquired_price: acquiredPrice,
    p_acquired_date: acquiredDate,
    p_acquired_via: 'manual',
    p_order_id: null,
    p_grading_company: gradingCompany,
    p_grade: grade,
  })
  if (error) return NextResponse.json({ error: 'Failed to add to collection' }, { status: 500 })

  // Notes + custom value aren't part of the increment RPC; set on the row.
  const customValue = body.custom_value === '' || body.custom_value == null ? null : Number(body.custom_value)
  const serial = typeof body.serial_number === 'string' && body.serial_number.trim() ? body.serial_number.trim() : null
  const cert = typeof body.cert_number === 'string' && body.cert_number.trim() ? body.cert_number.trim() : null
  const extra: Record<string, unknown> = {}
  if (notes) extra.notes = notes
  if (customValue != null && Number.isFinite(customValue) && customValue >= 0) extra.custom_value = customValue
  if (serial) extra.serial_number = serial
  if (cert) extra.cert_number = cert
  if (Object.keys(extra).length && row?.id) {
    await supabase.from('collections').update(extra).eq('id', row.id)
  }

  return NextResponse.json({ ok: true, item: row })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  // Variant-level fields only. Quantity / price / date are owned by
  // collection_lots now (a trigger rolls them up into this line); edit those
  // through /api/collection/lots.
  const patch: Record<string, unknown> = {}
  if ('notes' in body) patch.notes = body.notes?.trim() || null
  if ('custom_value' in body) {
    patch.custom_value = body.custom_value === '' || body.custom_value == null ? null : Number(body.custom_value)
  }
  if ('cert_number' in body) patch.cert_number = body.cert_number?.trim() || null
  if ('serial_number' in body) patch.serial_number = body.serial_number?.trim() || null
  // Correcting a logged grade: the grade and BGS subgrades on a slab line.
  if ('grade' in body && typeof body.grade === 'string' && body.grade) patch.grade = body.grade
  if ('subgrades' in body) {
    const sg = body.subgrades && typeof body.subgrades === 'object'
      ? Object.fromEntries(Object.entries(body.subgrades).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, Number(v)]))
      : null
    patch.subgrades = sg && Object.keys(sg).length ? sg : null
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  patch.updated_at = new Date().toISOString()

  // RLS scopes the update to the owner's row.
  const { data, error } = await supabase
    .from('collections')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Failed to update.' }, { status: 500 })
  return NextResponse.json({ ok: true, item: data })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const { error } = await supabase.from('collections').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
