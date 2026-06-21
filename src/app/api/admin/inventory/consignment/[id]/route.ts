import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

/** Admin-only patch for a single consignment_item row. Supports
 *  partial updates — pass only the fields you want to change.
 *  Used by the /admin/inventory Consignment tab's inline edits:
 *  setting/updating the relist (ask) price, marking listed, writing
 *  it off (rejected), etc. */
interface PatchBody {
  ask_price?: number
  status?: 'confirmed' | 'listed' | 'sold' | 'rejected'
  listing_id?: string | null
  notes?: string | null
}

const VALID_STATUSES = new Set(['confirmed', 'listed', 'sold', 'rejected'])

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await request.json().catch(() => ({}))) as PatchBody
  const update: Record<string, unknown> = {}

  if (body.ask_price !== undefined) {
    if (!Number.isFinite(body.ask_price) || body.ask_price < 0) {
      return NextResponse.json({ error: 'ask_price must be a non-negative number' }, { status: 400 })
    }
    update.ask_price = body.ask_price
  }

  if (body.status !== undefined) {
    if (!VALID_STATUSES.has(body.status)) {
      return NextResponse.json({ error: `status must be one of: ${[...VALID_STATUSES].join(', ')}` }, { status: 400 })
    }
    update.status = body.status
    // Stamp timestamps as the lifecycle advances. Idempotent — if
    // an admin re-marks listed, we keep the original listed_at.
    if (body.status === 'listed') update.listed_at = new Date().toISOString()
    if (body.status === 'sold' || body.status === 'rejected') {
      update.resolved_at = new Date().toISOString()
    }
  }

  if (body.listing_id !== undefined) {
    update.listing_id = body.listing_id
  }

  if (body.notes !== undefined) {
    update.notes = body.notes
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('consignment_items')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, row: data })
}
