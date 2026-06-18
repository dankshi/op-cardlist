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
    const gradingCost = body.grading_cost === '' || body.grading_cost == null ? 0 : Number(body.grading_cost)
    const shippingCost = body.shipping_cost === '' || body.shipping_cost == null ? 0 : Number(body.shipping_cost)
    // Each card is an individual slab: one { grade, cert } per copy being graded.
    const copies = Array.isArray(body.copies) ? body.copies : []
    if (!collectionId || !company) {
      return NextResponse.json({ error: 'collection_id and grading_company are required' }, { status: 400 })
    }
    if (copies.length === 0 || copies.some((c: { grade?: string }) => !c || typeof c.grade !== 'string' || !c.grade)) {
      return NextResponse.json({ error: 'Each copy needs a grade' }, { status: 400 })
    }
    if (!Number.isFinite(gradingCost) || gradingCost < 0 || !Number.isFinite(shippingCost) || shippingCost < 0) {
      return NextResponse.json({ error: 'Invalid grading or shipping cost' }, { status: 400 })
    }

    // Verify ownership + that there are enough copies to grade.
    const { data: line } = await supabase
      .from('collections')
      .select('id, quantity')
      .eq('id', collectionId)
      .eq('user_id', user.id)
      .single()
    if (!line) return NextResponse.json({ error: 'Collection line not found' }, { status: 404 })
    if (copies.length > (line.quantity ?? 0)) {
      return NextResponse.json({ error: `Only ${line.quantity} copy(ies) to grade` }, { status: 400 })
    }

    // Split the grading + shipping cost evenly across the copies; capitalize each
    // share into that slab's basis. One call per copy → one slab line + one
    // grade transaction each.
    const n = copies.length
    const feeEach = Math.round((gradingCost / n) * 100) / 100
    const shipEach = Math.round((shippingCost / n) * 100) / 100
    let lastLine = null
    for (let i = 0; i < n; i++) {
      const { data, error } = await supabase.rpc('regrade_one_copy', {
        p_collection_id: collectionId,
        p_grading_company: company,
        p_grade: copies[i].grade,
        p_cert_number: typeof copies[i].cert === 'string' && copies[i].cert.trim() ? copies[i].cert.trim() : null,
        p_grading_cost: feeEach,
        p_shipping_cost: shipEach,
      })
      if (error) return NextResponse.json({ error: error.message || 'Failed to grade a copy' }, { status: 500 })
      lastLine = data
    }
    return NextResponse.json({ ok: true, line: lastLine, graded: n })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
