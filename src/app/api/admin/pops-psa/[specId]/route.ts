import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

/** PATCH /api/admin/pops-psa/[specId]
 *  Body: { cardId: string | null }
 *
 *  Sets the card_id mapping for a PSA spec. Admin-only (verifies the
 *  logged-in user has profiles.is_admin=true). Passing cardId=null
 *  clears the mapping. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ specId: string }> },
) {
  const { specId: specIdRaw } = await params
  const specId = Number(specIdRaw)
  if (!Number.isFinite(specId)) {
    return NextResponse.json({ error: 'Invalid specId' }, { status: 400 })
  }

  let body: { cardId: string | null; force?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (body.cardId !== null && typeof body.cardId !== 'string') {
    return NextResponse.json({ error: 'cardId must be a string or null' }, { status: 400 })
  }
  const force = body.force === true

  // Auth check via session; write via service role (pops_psa is RLS-gated).
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const { data: profile } = await authClient
    .from('profiles')
    .select('is_admin, display_name, username')
    .eq('id', user.id)
    .single()
  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const mappedBy = profile.display_name || profile.username || user.email || user.id
  const admin = getSupabaseAdmin()

  // Verify the spec exists. If the admin pasted a URL for a spec we
  // haven't ingested from PSA yet, the silent UPDATE-0-rows would show
  // "✓ Linked" with nothing actually changed. Better to surface that.
  const { data: existingSpec } = await admin
    .from('pops_psa')
    .select('spec_id, card_id')
    .eq('spec_id', specId)
    .maybeSingle()
  if (!existingSpec) {
    return NextResponse.json({
      error: `PSA spec ${specId} not found in our DB. Run scripts/psa-pop-fetch.ts to ingest it from PSA, then try again.`,
    }, { status: 404 })
  }

  // pops_psa has a UNIQUE(card_id) constraint — only one spec per card.
  // If the target card is already linked to a different spec, surface
  // the conflict to the admin instead of silently overwriting. They can
  // re-submit with force=true to "steal" the link.
  if (body.cardId) {
    const { data: conflict } = await admin
      .from('pops_psa')
      .select('spec_id, description, variety')
      .eq('card_id', body.cardId)
      .neq('spec_id', specId)
      .maybeSingle()
    if (conflict) {
      if (!force) {
        return NextResponse.json({
          error: 'conflict',
          conflict: {
            specId: conflict.spec_id,
            description: conflict.description,
            variety: conflict.variety,
          },
          message: `Card ${body.cardId} is already linked to spec ${conflict.spec_id} (${conflict.description}). Re-submit with force=true to move the link.`,
        }, { status: 409 })
      }
      // Force path: clear the other spec's card_id first.
      const { error: clearErr } = await admin
        .from('pops_psa')
        .update({ card_id: null })
        .eq('spec_id', conflict.spec_id)
      if (clearErr) {
        console.error(`Failed to clear conflicting spec ${conflict.spec_id}:`, clearErr)
        return NextResponse.json({ error: clearErr.message }, { status: 500 })
      }
    }
  }

  // Manual link via admin UI — flag as such so a future auto-rematch
  // preserves it instead of overwriting with a different guess.
  const { error } = await admin
    .from('pops_psa')
    .update({
      card_id: body.cardId,
      source: 'manual',
      mapped_by: mappedBy,
      mapped_at: new Date().toISOString(),
    })
    .eq('spec_id', specId)
  if (error) {
    console.error(`pops_psa update failed for spec ${specId}:`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  revalidatePath('/admin/psa-pops')
  if (body.cardId) revalidatePath(`/card/${body.cardId}`)

  return NextResponse.json({ success: true })
}
