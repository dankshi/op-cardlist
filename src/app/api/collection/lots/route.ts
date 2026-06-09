import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// CRUD for collection_lots — the per-acquisition cost-basis rows under a
// collection line (migration 20260614). All operations run on the caller's own
// rows via the session client; the collection_lots RLS policy scopes every
// read/write to lots whose parent line is owned by auth.uid(). A trigger keeps
// the parent collections row's quantity / acquired_price / acquired_date in
// sync, so callers never touch those directly.

const toQty = (v: unknown) => Math.max(1, Math.floor(Number(v) || 1))
const toPrice = (v: unknown) =>
  v === '' || v == null ? null : Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : undefined
const toDate = (v: unknown) => (typeof v === 'string' && v ? v : null)

/** List the lots for a line, loose (unpriced) first then oldest acquisition. */
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const collectionId = new URL(request.url).searchParams.get('collection_id')
  if (!collectionId) return NextResponse.json({ error: 'collection_id is required' }, { status: 400 })

  const { data, error } = await supabase
    .from('collection_lots')
    .select('*')
    .eq('collection_id', collectionId)
    .order('price_paid', { ascending: true, nullsFirst: true })
    .order('acquired_date', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: 'Failed to load lots' }, { status: 500 })
  return NextResponse.json({ lots: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const collectionId = typeof body.collection_id === 'string' ? body.collection_id : ''
  if (!collectionId) return NextResponse.json({ error: 'collection_id is required' }, { status: 400 })

  // Stepper path: drive the line's total quantity by adjusting its lots.
  if (body.action === 'set_total') {
    return setTotal(supabase, collectionId, toQty(body.total_quantity))
  }

  const price = toPrice(body.price_paid)
  if (price === undefined) return NextResponse.json({ error: 'Invalid price' }, { status: 400 })
  const gradingCost = toPrice(body.grading_cost)
  if (gradingCost === undefined) return NextResponse.json({ error: 'Invalid grading cost' }, { status: 400 })

  const { data, error } = await supabase
    .from('collection_lots')
    .insert({
      collection_id: collectionId,
      quantity: toQty(body.quantity),
      price_paid: price,
      acquired_date: toDate(body.acquired_date),
      grading_cost: gradingCost ?? 0,
    })
    .select()
    .single()
  // RLS rejects a collection_id the caller doesn't own (no row inserted).
  if (error) return NextResponse.json({ error: 'Failed to add lot' }, { status: 500 })
  return NextResponse.json({ ok: true, lot: data })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (body.quantity != null) patch.quantity = toQty(body.quantity)
  if ('price_paid' in body) {
    const price = toPrice(body.price_paid)
    if (price === undefined) return NextResponse.json({ error: 'Invalid price' }, { status: 400 })
    patch.price_paid = price
  }
  if ('grading_cost' in body) {
    const gc = toPrice(body.grading_cost)
    if (gc === undefined) return NextResponse.json({ error: 'Invalid grading cost' }, { status: 400 })
    patch.grading_cost = gc ?? 0
  }
  if ('acquired_date' in body) patch.acquired_date = toDate(body.acquired_date)
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  patch.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('collection_lots')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: 'Failed to update lot' }, { status: 500 })
  return NextResponse.json({ ok: true, lot: data })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  // Grab the parent line first so we can clean it up if this was its last lot.
  const { data: lot } = await supabase.from('collection_lots').select('collection_id').eq('id', id).single()

  const { error } = await supabase.from('collection_lots').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Failed to delete lot' }, { status: 500 })

  if (lot?.collection_id) {
    const { count } = await supabase
      .from('collection_lots')
      .select('*', { count: 'exact', head: true })
      .eq('collection_id', lot.collection_id)
    if ((count ?? 0) === 0) {
      await supabase.from('collections').delete().eq('id', lot.collection_id)
    }
  }
  return NextResponse.json({ ok: true })
}

/** Move a line's total quantity to `target` by adjusting its lots: grow/shrink
 *  the loose (unpriced) lot first, then trim the most-recent priced lots. Used
 *  by the inline +/− stepper so a quick quantity tweak never needs a price. */
async function setTotal(
  supabase: Awaited<ReturnType<typeof createClient>>,
  collectionId: string,
  target: number,
) {
  const { data: lots, error } = await supabase
    .from('collection_lots')
    .select('id, quantity, price_paid, acquired_date, created_at')
    .eq('collection_id', collectionId)
  if (error) return NextResponse.json({ error: 'Failed to load lots' }, { status: 500 })

  const current = (lots ?? []).reduce((s, l) => s + l.quantity, 0)
  const delta = target - current
  if (delta === 0) return NextResponse.json({ ok: true })

  if (delta > 0) {
    const loose = (lots ?? []).find(l => l.price_paid == null)
    if (loose) {
      await supabase.from('collection_lots').update({ quantity: loose.quantity + delta, updated_at: new Date().toISOString() }).eq('id', loose.id)
    } else {
      // RLS rejects a collection the caller doesn't own.
      const { error: insErr } = await supabase.from('collection_lots').insert({ collection_id: collectionId, quantity: delta, price_paid: null })
      if (insErr) return NextResponse.json({ error: 'Failed to update quantity' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  // Reduce: loose lot first, then priced lots most-recent-first. Floor at 1
  // total (use the lot editor's Remove to delete a line entirely).
  let need = -delta
  const order = [...(lots ?? [])].sort((a, b) => {
    const ap = a.price_paid == null ? 0 : 1
    const bp = b.price_paid == null ? 0 : 1
    if (ap !== bp) return ap - bp
    return (b.acquired_date ?? b.created_at ?? '').localeCompare(a.acquired_date ?? a.created_at ?? '')
  })
  for (const lot of order) {
    if (need <= 0) break
    const take = Math.min(lot.quantity, need)
    if (take >= lot.quantity) {
      await supabase.from('collection_lots').delete().eq('id', lot.id)
    } else {
      await supabase.from('collection_lots').update({ quantity: lot.quantity - take, updated_at: new Date().toISOString() }).eq('id', lot.id)
    }
    need -= take
  }
  return NextResponse.json({ ok: true })
}
