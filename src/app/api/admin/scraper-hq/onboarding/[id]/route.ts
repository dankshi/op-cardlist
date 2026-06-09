import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const REPO = process.env.GITHUB_DISPATCH_REPO ?? 'dankshi/op-cardlist'
const REF = process.env.GITHUB_DISPATCH_REF ?? 'nomi'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { supabase, user }
}

/** Preview the staged cards for a draft (count + a sample). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { id } = await params
  const onboardingId = Number(id)

  const { data: onboarding } = await ctx.supabase.from('set_onboarding').select('*').eq('id', onboardingId).single()
  const { data: sample } = await ctx.supabase
    .from('staged_cards')
    .select('id, name, rarity, variant, image_url')
    .eq('onboarding_id', onboardingId)
    .order('id')
    .limit(20)
  const { count } = await ctx.supabase
    .from('staged_cards')
    .select('*', { count: 'exact', head: true })
    .eq('onboarding_id', onboardingId)

  return NextResponse.json({ onboarding, stagedCount: count ?? 0, sample: sample ?? [] })
}

/** Actions: 'stage' (dispatch the staging scrape) or 'promote' (copy staged
 *  cards into the live catalog and register the set for pricing). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { id } = await params
  const onboardingId = Number(id)
  const body = await request.json().catch(() => ({}))
  const action = body.action

  const admin = getSupabaseAdmin()
  const { data: ob } = await admin.from('set_onboarding').select('*').eq('id', onboardingId).single()
  if (!ob) return NextResponse.json({ error: 'Onboarding not found' }, { status: 404 })

  if (action === 'stage') {
    const { data: tok } = await admin.from('scraper_settings').select('value').eq('key', 'github_token').maybeSingle()
    const token = (tok?.value as string | undefined) ?? process.env.GITHUB_DISPATCH_TOKEN
    if (!token) return NextResponse.json({ error: 'No GitHub token set. Add one in the HQ first.' }, { status: 400 })

    const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/update-onboard.yml/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: REF, inputs: { onboarding_id: String(onboardingId) } }),
    })
    if (res.status !== 204) {
      const detail = await res.text().catch(() => '')
      return NextResponse.json({ error: `GitHub dispatch failed (${res.status}).`, detail: detail.slice(0, 300) }, { status: 502 })
    }
    await admin.from('set_onboarding').update({ status: 'staging', error: null, updated_at: new Date().toISOString() }).eq('id', onboardingId)
    return NextResponse.json({ ok: true, status: 'staging' })
  }

  if (action === 'promote') {
    if (ob.status !== 'staged') {
      return NextResponse.json({ error: `Can only promote a 'staged' set (currently '${ob.status}').` }, { status: 400 })
    }
    const { data: staged } = await admin.from('staged_cards').select('*').eq('onboarding_id', onboardingId)
    const rows = staged ?? []
    if (rows.length === 0) return NextResponse.json({ error: 'No staged cards to promote.' }, { status: 400 })

    // 1) the set
    const { error: setErr } = await admin.from('card_sets').upsert({
      id: ob.set_id,
      name: ob.name,
      series_id: ob.bandai_series_id,
      release_date: ob.release_date,
      card_count: rows.length,
    }, { onConflict: 'id' })
    if (setErr) return NextResponse.json({ error: `card_sets: ${setErr.message}` }, { status: 500 })

    // 2) the cards (brand-new set → seed art_style too)
    const cardRows = rows.map(r => ({
      id: r.id, base_id: r.base_id, set_id: r.set_id, name: r.name, type: r.type,
      colors: r.colors, rarity: r.rarity, cost: r.cost, power: r.power, counter: r.counter,
      life: r.life, attribute: r.attribute, traits: r.traits, effect: r.effect,
      trigger_text: r.trigger_text, image_url: r.image_url, variant: r.variant, art_style: r.art_style,
    }))
    for (let i = 0; i < cardRows.length; i += 500) {
      const { error: cardErr } = await admin.from('cards').upsert(cardRows.slice(i, i + 500), { onConflict: 'id' })
      if (cardErr) return NextResponse.json({ error: `cards: ${cardErr.message}` }, { status: 500 })
    }

    // 3) register TCGplayer slugs so prices/sales discover the set
    if (ob.tcgplayer_slugs?.length) {
      await admin.from('set_tcgplayer_slugs').upsert({ set_id: ob.set_id, slugs: ob.tcgplayer_slugs }, { onConflict: 'set_id' })
    }

    await admin.from('set_onboarding').update({ status: 'promoted', updated_at: new Date().toISOString() }).eq('id', onboardingId)
    return NextResponse.json({ ok: true, promoted: cardRows.length })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
