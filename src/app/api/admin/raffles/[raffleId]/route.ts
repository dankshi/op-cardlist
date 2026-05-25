import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

const ALLOWED_STATUSES = new Set(['active', 'drawn', 'cancelled'])

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401 as const }
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  if (!profile?.is_admin) return { error: 'Forbidden', status: 403 as const }
  return { user }
}

/** PATCH editable raffle fields. Editable: title, prize_description,
 *  prize_image_url, status, ends_at. Other columns (winner_user_id,
 *  drawn_at, slug, created_at) are managed by the draw endpoint or the
 *  bootstrap migration. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ raffleId: string }> }
) {
  const gate = await requireAdmin()
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status })
  }

  const { raffleId } = await params
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const update: Record<string, unknown> = {}

  if (typeof body.title === 'string' && body.title.trim().length > 0) {
    update.title = body.title.trim()
  }
  if (typeof body.prize_description === 'string' && body.prize_description.trim().length > 0) {
    update.prize_description = body.prize_description.trim()
  }
  if ('prize_image_url' in body) {
    const v = body.prize_image_url
    if (v === null || v === '') {
      update.prize_image_url = null
    } else if (typeof v === 'string') {
      update.prize_image_url = v.trim()
    }
  }
  if (typeof body.status === 'string') {
    if (!ALLOWED_STATUSES.has(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    update.status = body.status
  }
  if ('ends_at' in body) {
    const v = body.ends_at
    if (v === null || v === '') {
      update.ends_at = null
    } else if (typeof v === 'string') {
      const d = new Date(v)
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: 'Invalid ends_at' }, { status: 400 })
      }
      update.ends_at = d.toISOString()
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('raffles')
    .update(update)
    .eq('id', raffleId)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[admin/raffles] update failed', error)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
