import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Collection adjustments (docs/collection-pnl.md, Phase 2): currently the
// 'regrade' action — capitalize a grading fee and move a lot to its new grade
// as a logged event. The regrade RPC is security-invoker, so RLS scopes every
// write to the caller's own rows.

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const action = body.action

  if (action === 'regrade') {
    const collectionId = typeof body.collection_id === 'string' ? body.collection_id : ''
    const company = typeof body.grading_company === 'string' && body.grading_company ? body.grading_company : ''
    const grade = typeof body.grade === 'string' && body.grade ? body.grade : ''
    const gradingCost = body.grading_cost === '' || body.grading_cost == null ? 0 : Number(body.grading_cost)
    const shippingCost = body.shipping_cost === '' || body.shipping_cost == null ? 0 : Number(body.shipping_cost)
    if (!collectionId || !company || !grade) {
      return NextResponse.json({ error: 'collection_id, grading_company, and grade are required' }, { status: 400 })
    }
    if (!Number.isFinite(gradingCost) || gradingCost < 0) {
      return NextResponse.json({ error: 'Invalid grading cost' }, { status: 400 })
    }
    if (!Number.isFinite(shippingCost) || shippingCost < 0) {
      return NextResponse.json({ error: 'Invalid shipping cost' }, { status: 400 })
    }

    // Ownership + the lots to move. RLS already scopes the lots read to the
    // owner, but verify the line is the caller's for a clean 404.
    const { data: line } = await supabase
      .from('collections')
      .select('id')
      .eq('id', collectionId)
      .eq('user_id', user.id)
      .single()
    if (!line) return NextResponse.json({ error: 'Collection line not found' }, { status: 404 })

    const { data: lots } = await supabase
      .from('collection_lots')
      .select('id')
      .eq('collection_id', collectionId)
      .order('acquired_date', { ascending: true, nullsFirst: true })
      .order('created_at', { ascending: true })
    if (!lots?.length) return NextResponse.json({ error: 'Nothing to regrade' }, { status: 400 })

    // Move every lot to the new grade; put the whole grading + shipping fee on
    // the first (it capitalizes into that lot's basis for the graded line).
    let lastLine = null
    for (let i = 0; i < lots.length; i++) {
      const { data, error } = await supabase.rpc('regrade_collection_lot', {
        p_lot_id: lots[i].id,
        p_grading_company: company,
        p_grade: grade,
        p_grading_cost: i === 0 ? gradingCost : 0,
        p_shipping_cost: i === 0 ? shippingCost : 0,
      })
      if (error) return NextResponse.json({ error: error.message || 'Failed to regrade' }, { status: 500 })
      lastLine = data
    }
    return NextResponse.json({ ok: true, line: lastLine })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
