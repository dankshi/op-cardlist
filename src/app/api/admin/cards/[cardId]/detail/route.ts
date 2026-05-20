import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/** GET /api/admin/cards/[cardId]/detail
 *  Returns the bundle the admin card-editor modal needs to render the
 *  full "command center" view: the cards row, current TCGplayer mapping,
 *  and PSA spec mapping. Read-only — edits go through PATCH on the
 *  parent route and POST /api/mappings for TCG link assignment.
 *
 *  Admin-gated. Returns 404 when the cardId doesn't exist. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ cardId: string }> },
) {
  const { cardId } = await params
  if (!cardId) return NextResponse.json({ error: 'Missing cardId' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  // All three reads can race — none depend on each other.
  const [cardRes, mappingRes, psaRes] = await Promise.all([
    supabase
      .from('cards')
      .select('id, name, set_id, type, rarity, art_style, variant, image_url, base_id')
      .eq('id', cardId)
      .maybeSingle(),
    supabase
      .from('card_tcgplayer_mapping')
      .select('tcgplayer_product_id, tcgplayer_url, tcgplayer_name, source, mapped_by, updated_at')
      .eq('card_id', cardId)
      .maybeSingle(),
    supabase
      .from('pops_psa')
      .select('spec_id, description, set_code, variety, total_pop, psa_card_number')
      .eq('card_id', cardId)
      .maybeSingle(),
  ])

  if (cardRes.error || !cardRes.data) {
    return NextResponse.json({ error: 'Card not found' }, { status: 404 })
  }

  return NextResponse.json({
    card: cardRes.data,
    mapping: mappingRes.data ?? null,
    psa: psaRes.data ?? null,
  })
}
