import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { recomputeSlabCards } from '@/lib/slab-comp-recompute'

const STATUSES = new Set(['visible', 'hidden', 'excluded'])
const MAX_IDS = 500

async function requireAdminUser(): Promise<{ userId: string } | NextResponse> {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { data: profile } = await authClient.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  return { userId: user.id }
}

/** POST /api/admin/slab-sales/bulk
 *  Body: { ids: string[], status, excluded_reason? }
 *
 *  Apply one status to many sales at once (e.g. exclude a screen of lots).
 *  Recomputes every affected card's comp once. */
export async function POST(req: NextRequest) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  let body: { ids?: unknown; status?: string; excluded_reason?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : []
  const status = body.status
  if (ids.length === 0) return NextResponse.json({ error: 'ids must be a non-empty array' }, { status: 400 })
  if (ids.length > MAX_IDS) return NextResponse.json({ error: `at most ${MAX_IDS} ids per call` }, { status: 400 })
  if (!status || !STATUSES.has(status)) {
    return NextResponse.json({ error: `status must be one of: ${[...STATUSES].join(', ')}` }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  // Which cards are affected? Needed to recompute their comps after the update.
  const { data: affected } = await admin.from('slab_sales').select('card_id').in('id', ids)
  const cardIds = [...new Set((affected ?? []).map(r => r.card_id as string))]

  const { error } = await admin
    .from('slab_sales')
    .update({
      status,
      excluded_reason: status === 'visible' ? null : (body.excluded_reason?.trim() || null),
      reviewed_by: auth.userId,
      reviewed_at: new Date().toISOString(),
    })
    .in('id', ids)
  if (error) {
    console.error('slab_sales bulk update failed:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (cardIds.length) await recomputeSlabCards(admin, { cardIds })
  revalidatePath('/admin/slab-sales')
  for (const cardId of cardIds) revalidatePath(`/card/${cardId.toLowerCase()}`)

  return NextResponse.json({ success: true, updated: ids.length, cardsRecomputed: cardIds.length })
}
