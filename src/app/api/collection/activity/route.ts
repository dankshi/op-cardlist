import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Unified buy/sell/grade activity feed (docs/collection-pnl.md, Phase 2/3).
// Reads the `collection_activity` view (security_invoker, RLS-scoped to the
// caller). With ?card_id= it's the per-card history; without, the global ledger
// for the Phase 3 page.

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const cardId = url.searchParams.get('card_id')
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 200))

  let query = supabase
    .from('collection_activity')
    .select('*')
    .order('happened_at', { ascending: false })
    .limit(limit)
  if (cardId) query = query.eq('card_id', cardId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Failed to load activity' }, { status: 500 })
  return NextResponse.json({ activity: data ?? [] })
}
