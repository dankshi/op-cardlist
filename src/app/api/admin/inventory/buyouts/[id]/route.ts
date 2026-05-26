import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

/** Admin-only patch for a single buyouts row. Lets ops record
 *  the carrier claim lifecycle: assign a claim ID, advance from
 *  filed → paid (with recovered amount), or mark denied. */
interface PatchBody {
  carrier_claim_id?: string | null
  carrier_claim_status?: 'pending' | 'filed' | 'paid' | 'denied'
  recovered_amount?: number
  notes?: string | null
}

const VALID_CLAIM_STATUSES = new Set(['pending', 'filed', 'paid', 'denied'])

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

  if (body.carrier_claim_id !== undefined) {
    update.carrier_claim_id = body.carrier_claim_id
  }
  if (body.carrier_claim_status !== undefined) {
    if (!VALID_CLAIM_STATUSES.has(body.carrier_claim_status)) {
      return NextResponse.json({ error: `carrier_claim_status must be one of: ${[...VALID_CLAIM_STATUSES].join(', ')}` }, { status: 400 })
    }
    update.carrier_claim_status = body.carrier_claim_status
    if (body.carrier_claim_status === 'paid' || body.carrier_claim_status === 'denied') {
      update.recovered_at = new Date().toISOString()
    }
  }
  if (body.recovered_amount !== undefined) {
    if (!Number.isFinite(body.recovered_amount) || body.recovered_amount < 0) {
      return NextResponse.json({ error: 'recovered_amount must be a non-negative number' }, { status: 400 })
    }
    update.recovered_amount = body.recovered_amount
  }
  if (body.notes !== undefined) {
    update.notes = body.notes
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('buyouts')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, row: data })
}
