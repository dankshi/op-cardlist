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

  // ── Grade-event sync (the grading log's single source of truth) ──────────
  // The grading log is built only from 'grade' rows in collection_adjustments.
  // So the per-card modal must write to the SAME place the submission builder
  // does: keep this slab's grade event in lockstep with edits here, and CREATE
  // one when the user records a self-grade (a grading cost, graded date, or
  // submission ID) on a slab that has none. A bare grade/cert with no grading
  // info (i.e. a bought slab) stays out of the log.
  if (data?.grading_company) {
    const toGrade = `${data.grading_company} ${data.grade}`
    // amount = the full capitalized grading cost (fee + shipping); shipping is
    // also stored on its own so history can break it out ("incl. $X ship").
    const cost = 'grading_cost' in body && body.grading_cost !== '' && body.grading_cost != null && Number.isFinite(Number(body.grading_cost))
      ? Number(body.grading_cost) : null
    const ship = 'shipping_cost' in body && body.shipping_cost !== '' && body.shipping_cost != null && Number.isFinite(Number(body.shipping_cost))
      ? Number(body.shipping_cost) : null
    const gradedAt = typeof body.graded_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.graded_at)
      ? new Date(body.graded_at + 'T12:00:00Z').toISOString() : null
    const hasLabel = 'submission_label' in body
    const label = hasLabel && typeof body.submission_label === 'string' && body.submission_label.trim() ? body.submission_label.trim() : null

    const { data: ev } = await supabase
      .from('collection_adjustments')
      .select('id, submission_id')
      .eq('collection_id', id).eq('type', 'grade')
      .order('happened_at', { ascending: false }).limit(1).maybeSingle()

    if (ev) {
      // Keep the existing event aligned with the slab. amount mirrors the lot's
      // grading_cost (same convention the regrade RPCs use).
      const upd: Record<string, unknown> = {}
      if ('grade' in patch) upd.to_grade = toGrade
      if (cost != null) upd.amount = cost
      if (ship != null) upd.shipping_cost = ship > 0 ? ship : null
      if (gradedAt) upd.happened_at = gradedAt
      if (Object.keys(upd).length) await supabase.from('collection_adjustments').update(upd).eq('id', ev.id)
      // The submission ID belongs to the whole batch, not just this slab.
      if (hasLabel) {
        if (ev.submission_id) await supabase.from('collection_adjustments').update({ submission_label: label }).eq('submission_id', ev.submission_id)
        else await supabase.from('collection_adjustments').update({ submission_label: label }).eq('id', ev.id)
      }
    } else if ((cost != null && cost > 0) || (ship != null && ship > 0) || label != null || gradedAt != null) {
      // No event yet, but the user recorded grading info → log it so the slab
      // shows up in the grading log alongside builder-graded cards.
      await supabase.from('collection_adjustments').insert({
        user_id: user.id, card_id: data.card_id, collection_id: id, type: 'grade',
        from_grade: 'Raw', to_grade: toGrade, amount: cost ?? 0, shipping_cost: ship != null && ship > 0 ? ship : null,
        submission_id: null, submission_label: label, happened_at: gradedAt ?? new Date().toISOString(), note: null,
      })
    }
  }

  return NextResponse.json({ ok: true, item: data })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  // Guard against erasing history: if this line has recorded sales or grade
  // events, a hard delete would drop its buy lots and orphan that history. Those
  // cards should be disposed via "Mark as sold", not deleted. Pure mistakes
  // (no sales/grades) delete freely. Pass ?force=1 to override intentionally.
  const force = new URL(request.url).searchParams.get('force') === '1'
  if (!force) {
    const [{ count: saleCount }, { count: gradeCount }] = await Promise.all([
      supabase.from('collection_sales').select('*', { count: 'exact', head: true }).eq('collection_id', id),
      supabase.from('collection_adjustments').select('*', { count: 'exact', head: true }).eq('collection_id', id).eq('type', 'grade'),
    ])
    if ((saleCount ?? 0) > 0 || (gradeCount ?? 0) > 0) {
      return NextResponse.json({
        error: 'This card has sale/grade history. Use "Mark as sold" to dispose of it (keeps the history), or remove with force to erase it.',
        hasHistory: true,
      }, { status: 409 })
    }
  }

  const { error } = await supabase.from('collections').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
