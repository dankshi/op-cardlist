import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Settings an admin can manage from the HQ. The TCGplayer cookie powers the
// deep sales feed; the GitHub token lets the HQ trigger workflow runs.
const ALLOWED_KEYS = ['tcgplayer_auth_cookie', 'github_token'] as const
type SettingKey = (typeof ALLOWED_KEYS)[number]

/** Save a scraper setting (admin only). Never returns the stored value. */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  // Back-compat: no key => the TCGplayer cookie.
  const key = (typeof body.key === 'string' ? body.key : 'tcgplayer_auth_cookie') as SettingKey
  if (!ALLOWED_KEYS.includes(key)) return NextResponse.json({ error: 'Unknown setting' }, { status: 400 })

  let value = typeof body.value === 'string' ? body.value.trim()
    : typeof body.cookie === 'string' ? body.cookie.trim() : ''
  if (!value) return NextResponse.json({ error: 'Value is required' }, { status: 400 })

  // For the cookie, tolerate a pasted "TCGAuthTicket_Production=<value>; ..." —
  // store just the ticket the scraper expects.
  if (key === 'tcgplayer_auth_cookie') {
    const m = value.match(/TCGAuthTicket_Production=([^;]+)/)
    if (m) value = m[1].trim()
  }

  const { error } = await supabase
    .from('scraper_settings')
    .upsert(
      { key, value, updated_at: new Date().toISOString(), updated_by: user.id },
      { onConflict: 'key' },
    )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
