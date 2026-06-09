import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { recomputeSlabCards } from '@/lib/slab-comp-recompute'

const STATUSES = new Set(['visible', 'hidden', 'excluded'])

async function requireAdminUser(): Promise<{ userId: string } | NextResponse> {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { data: profile } = await authClient.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  return { userId: user.id }
}

/** PATCH /api/admin/slab-sales/[id]
 *  Body: { status: 'visible'|'hidden'|'excluded', excluded_reason?: string }
 *
 *  Curate one sale. Excluding/hiding removes it from the comp; restoring
 *  (status='visible') puts it back. Either way we recompute the affected
 *  variant immediately so the price corrects on the next render. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  let body: { status?: string; excluded_reason?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const status = body.status
  if (!status || !STATUSES.has(status)) {
    return NextResponse.json({ error: `status must be one of: ${[...STATUSES].join(', ')}` }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  // Fetch the row first so we know which variant's comp to recompute.
  const { data: row } = await admin.from('slab_sales').select('card_id').eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Sale not found' }, { status: 404 })

  const { error } = await admin
    .from('slab_sales')
    .update({
      status,
      excluded_reason: status === 'visible' ? null : (body.excluded_reason?.trim() || null),
      reviewed_by: auth.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) {
    console.error(`slab_sales status update failed for ${id}:`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const cardId = row.card_id as string
  await recomputeSlabCards(admin, { cardIds: [cardId] })
  revalidatePath('/admin/slab-sales')
  revalidatePath(`/card/${cardId.toLowerCase()}`)

  return NextResponse.json({ success: true })
}
