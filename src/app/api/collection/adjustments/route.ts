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

  // A grading SUBMISSION: a batch of individual copies — possibly different
  // cards, possibly a subset of a holding — sent to one grader together. Each
  // copy has its own grade + cert + grading fee; outbound + return shipping are
  // one cost for the whole batch, split evenly and capitalized per slab.
  if (action === 'grade_submission') {
    const company = typeof body.grading_company === 'string' && body.grading_company ? body.grading_company : ''
    const items = Array.isArray(body.items) ? body.items : []
    const outbound = body.outbound_shipping === '' || body.outbound_shipping == null ? 0 : Number(body.outbound_shipping)
    const ret = body.return_shipping === '' || body.return_shipping == null ? 0 : Number(body.return_shipping)
    if (!company) return NextResponse.json({ error: 'grading_company is required' }, { status: 400 })
    if (items.length === 0) return NextResponse.json({ error: 'Add at least one card' }, { status: 400 })
    if (items.some((it: { collection_id?: string; grade?: string }) => !it || typeof it.collection_id !== 'string' || typeof it.grade !== 'string' || !it.grade)) {
      return NextResponse.json({ error: 'Each card needs a grade' }, { status: 400 })
    }
    if (items.some((it: { cert?: unknown }) => typeof it.cert !== 'string' || !it.cert.trim())) {
      return NextResponse.json({ error: 'Each card needs a cert number' }, { status: 400 })
    }
    const fees = items.map((it: { grading_fee?: unknown }) => it.grading_fee === '' || it.grading_fee == null ? 0 : Number(it.grading_fee))
    if (fees.some((f: number) => !Number.isFinite(f) || f < 0)) return NextResponse.json({ error: 'Invalid grading fee' }, { status: 400 })
    if (![outbound, ret].every(x => Number.isFinite(x) && x >= 0)) return NextResponse.json({ error: 'Invalid shipping cost' }, { status: 400 })

    // Verify ownership + that we're not grading more copies than are owned.
    const byLine = new Map<string, number>()
    for (const it of items) byLine.set(it.collection_id, (byLine.get(it.collection_id) ?? 0) + 1)
    const { data: lines } = await supabase
      .from('collections').select('id, quantity').eq('user_id', user.id).in('id', [...byLine.keys()])
    const qtyById = new Map((lines ?? []).map(l => [l.id as string, l.quantity as number]))
    for (const [id, count] of byLine) {
      const q = qtyById.get(id)
      if (q == null) return NextResponse.json({ error: 'A selected card is not in your collection' }, { status: 404 })
      if (count > q) return NextResponse.json({ error: `Only ${q} raw copy(ies) available for one of the cards` }, { status: 400 })
    }

    const n = items.length
    const shipEach = Math.round(((outbound + ret) / n) * 100) / 100
    let graded = 0
    for (let i = 0; i < n; i++) {
      const it = items[i]
      // Subgrades only for BGS, and only when at least one is set.
      const sg = company === 'BGS' && it.subgrades && typeof it.subgrades === 'object'
        ? Object.fromEntries(Object.entries(it.subgrades).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, Number(v)]))
        : null
      const { error } = await supabase.rpc('regrade_one_copy', {
        p_collection_id: it.collection_id,
        p_grading_company: company,
        p_grade: it.grade,
        p_cert_number: typeof it.cert === 'string' && it.cert.trim() ? it.cert.trim() : null,
        p_grading_cost: fees[i],
        p_shipping_cost: shipEach,
        p_subgrades: sg && Object.keys(sg).length ? sg : null,
      })
      if (error) return NextResponse.json({ error: error.message || 'Failed to grade a copy', graded }, { status: 500 })
      graded++
    }
    return NextResponse.json({ ok: true, graded })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
