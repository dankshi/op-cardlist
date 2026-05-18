import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

/** POST /api/admin/psa-pops/ignored-varieties
 *  Body: { variety: string, ignored: boolean }
 *
 *  Adds the variety to psa_ignored_varieties (ignored=true) or removes it
 *  (ignored=false). Affects categorization on /admin/psa-pops on next
 *  render. Admin-only; auth checked via the session client, write via
 *  service role since psa_ignored_varieties is RLS-gated. */
export async function POST(req: NextRequest) {
  let body: { variety: string; ignored: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (typeof body.variety !== 'string' || body.variety.length === 0) {
    return NextResponse.json({ error: 'variety must be a non-empty string' }, { status: 400 })
  }
  if (typeof body.ignored !== 'boolean') {
    return NextResponse.json({ error: 'ignored must be a boolean' }, { status: 400 })
  }

  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { data: profile } = await authClient
    .from('profiles')
    .select('is_admin, display_name, username')
    .eq('id', user.id)
    .single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const ignoredBy = profile.display_name || profile.username || user.email || user.id
  const admin = getSupabaseAdmin()

  if (body.ignored) {
    const { error } = await admin
      .from('psa_ignored_varieties')
      .upsert({ variety: body.variety, ignored_by: ignoredBy, ignored_at: new Date().toISOString() }, { onConflict: 'variety' })
    if (error) {
      console.error(`psa_ignored_varieties upsert failed for "${body.variety}":`, error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  } else {
    const { error } = await admin
      .from('psa_ignored_varieties')
      .delete()
      .eq('variety', body.variety)
    if (error) {
      console.error(`psa_ignored_varieties delete failed for "${body.variety}":`, error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  return NextResponse.json({ success: true })
}
