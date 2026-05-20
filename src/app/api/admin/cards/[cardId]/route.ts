import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

// Textured Foil is an art_style (PRB premium foil treatment), not a
// rarity — the underlying card keeps its real rarity (often UC/R/SR).
const ALLOWED_ART_STYLES = new Set(['standard', 'alternate', 'manga', 'wanted', 'textured'])
// Rarities we recognise. SP/TR/SEC/L are "high rarities" (always shown);
// C/UC/R/P/SR are low rarities (hidden when art_style='standard').
const ALLOWED_RARITIES = new Set(['C', 'UC', 'R', 'SR', 'SEC', 'L', 'P', 'SP', 'TR'])

/** PATCH /api/admin/cards/[cardId]
 *  Body: { art_style?: string, rarity?: string }
 *
 *  Admin-only inline edit for the cards row. Currently editable fields:
 *  - art_style: standard / alternate / manga / wanted / textured
 *  - rarity: C / UC / R / SR / SEC / L / P / SP / TR */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ cardId: string }> },
) {
  const { cardId } = await params
  if (!cardId) {
    return NextResponse.json({ error: 'Missing cardId' }, { status: 400 })
  }

  let body: { art_style?: string; rarity?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  if (body.art_style !== undefined) {
    if (!ALLOWED_ART_STYLES.has(body.art_style)) {
      return NextResponse.json({ error: `art_style must be one of: ${[...ALLOWED_ART_STYLES].join(', ')}` }, { status: 400 })
    }
    updates.art_style = body.art_style
  }
  if (body.rarity !== undefined) {
    if (!ALLOWED_RARITIES.has(body.rarity)) {
      return NextResponse.json({ error: `rarity must be one of: ${[...ALLOWED_RARITIES].join(', ')}` }, { status: 400 })
    }
    updates.rarity = body.rarity
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No editable fields in body' }, { status: 400 })
  }

  // Auth check on the user's session client; the actual write goes
  // through the service-role client because the cards table is SELECT-only
  // for anon/authenticated (see migration 20260522). Without service
  // role the UPDATE silently affects 0 rows (no error returned).
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { data: profile } = await authClient
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const admin = getSupabaseAdmin()
  const { error } = await admin.from('cards').update(updates).eq('id', cardId)
  if (error) {
    console.error(`cards update failed for ${cardId}:`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Invalidate any cached versions of pages that show this card so the
  // next render fetches the updated rarity / art_style. revalidatePath
  // works alongside the client's router.refresh() to defeat both
  // Next.js's data cache and the browser/render cache.
  revalidatePath('/admin/psa-pops')
  revalidatePath('/admin/mappings')
  revalidatePath('/admin/cards')
  revalidatePath(`/card/${cardId}`)

  return NextResponse.json({ success: true })
}
