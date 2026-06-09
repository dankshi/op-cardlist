import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { supabase, user }
}

/** List set-onboarding drafts. */
export async function GET() {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { data } = await ctx.supabase.from('set_onboarding').select('*').order('created_at', { ascending: false })
  return NextResponse.json({ onboardings: data ?? [] })
}

/** Create a new-set onboarding draft. */
export async function POST(request: Request) {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const b = await request.json().catch(() => ({}))

  const setId = typeof b.set_id === 'string' ? b.set_id.trim().toLowerCase() : ''
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  const seriesId = typeof b.bandai_series_id === 'string' ? b.bandai_series_id.trim() : ''
  const site = b.bandai_site === 'asia-en' ? 'asia-en' : 'en'
  const slugs = Array.isArray(b.tcgplayer_slugs)
    ? b.tcgplayer_slugs.map((s: unknown) => String(s).trim()).filter(Boolean)
    : typeof b.tcgplayer_slugs === 'string'
      ? b.tcgplayer_slugs.split(',').map((s: string) => s.trim()).filter(Boolean)
      : []
  const releaseDate = typeof b.release_date === 'string' && b.release_date ? b.release_date : null

  if (!setId || !name || !seriesId) {
    return NextResponse.json({ error: 'set_id, name and bandai_series_id are required.' }, { status: 400 })
  }

  const { data, error } = await ctx.supabase
    .from('set_onboarding')
    .insert({
      set_id: setId,
      name,
      bandai_series_id: seriesId,
      bandai_site: site,
      tcgplayer_slugs: slugs,
      release_date: releaseDate,
      status: 'draft',
      created_by: ctx.user.id,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, onboarding: data })
}

/** Delete a draft (and its staged cards via cascade). */
export async function DELETE(request: Request) {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await ctx.supabase.from('set_onboarding').delete().eq('id', Number(id))
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
