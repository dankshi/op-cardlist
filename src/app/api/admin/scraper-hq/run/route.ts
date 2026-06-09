import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

const WORKFLOW_FILE: Record<string, string> = {
  prices: 'update-prices.yml',
  sales: 'update-sales.yml',
}
const REPO = process.env.GITHUB_DISPATCH_REPO ?? 'dankshi/op-cardlist'
const REF = process.env.GITHUB_DISPATCH_REF ?? 'nomi'

/** Trigger a full scraper job (prices/sales) on demand via GitHub
 *  workflow_dispatch. Admin only. The dispatched run records itself to
 *  scraper_runs when it starts, so it appears in the HQ history shortly. */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const job = typeof body.job === 'string' ? body.job : ''
  const workflow = WORKFLOW_FILE[job]
  if (!workflow) return NextResponse.json({ error: 'Unknown job' }, { status: 400 })

  const admin = getSupabaseAdmin()
  const { data: tok } = await admin.from('scraper_settings').select('value').eq('key', 'github_token').maybeSingle()
  const token = (tok?.value as string | undefined) ?? process.env.GITHUB_DISPATCH_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'No GitHub token set. Add one in the HQ to enable run triggers.' }, { status: 400 })
  }

  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: REF, inputs: { trigger_source: 'manual' } }),
  })

  if (res.status === 204) return NextResponse.json({ ok: true })
  const detail = await res.text().catch(() => '')
  const hint =
    res.status === 401 ? 'GitHub token is invalid or expired.' :
    res.status === 404 ? `Workflow not found on ${REF}, or token lacks Actions:write.` :
    res.status === 422 ? 'Workflow has no workflow_dispatch trigger on that ref.' :
    `GitHub API ${res.status}.`
  return NextResponse.json({ error: hint, detail: detail.slice(0, 300) }, { status: 502 })
}
