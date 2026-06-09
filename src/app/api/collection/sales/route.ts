import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Manual (off-platform) sale entry for the collection P&L ledger
// (docs/collection-pnl.md, Phase 2). Closes the line's lots oldest-first to get
// the cost basis, then records a `channel:'manual'` disposition. Nomi sales are
// recorded automatically on order authentication (src/lib/collectionSales.ts).

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const collectionId = typeof body.collection_id === 'string' ? body.collection_id : ''
  const quantity = Math.max(1, Math.floor(Number(body.quantity) || 0))
  const proceeds = body.proceeds === '' || body.proceeds == null ? null : Number(body.proceeds)
  const soldAt = typeof body.sold_at === 'string' && body.sold_at ? body.sold_at : new Date().toISOString()
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null

  if (!collectionId) return NextResponse.json({ error: 'collection_id is required' }, { status: 400 })
  if (!quantity) return NextResponse.json({ error: 'quantity is required' }, { status: 400 })
  if (proceeds != null && (!Number.isFinite(proceeds) || proceeds < 0)) {
    return NextResponse.json({ error: 'Invalid proceeds' }, { status: 400 })
  }

  // Ownership + variant lookup. close_collection_lots is security-definer and
  // doesn't itself check ownership, so the caller must — verify the line is the
  // user's before closing its lots.
  const { data: line } = await supabase
    .from('collections')
    .select('id, card_id, quantity, grading_company, grade')
    .eq('id', collectionId)
    .eq('user_id', user.id)
    .single()
  if (!line) return NextResponse.json({ error: 'Collection line not found' }, { status: 404 })
  if (quantity > line.quantity) {
    return NextResponse.json({ error: `You only hold ${line.quantity}` }, { status: 400 })
  }

  const { data: basisData, error: closeErr } = await supabase.rpc('close_collection_lots', {
    p_collection_id: collectionId,
    p_quantity: quantity,
  })
  if (closeErr) return NextResponse.json({ error: 'Failed to record sale' }, { status: 500 })
  const costBasis = basisData == null ? null : Number(basisData)

  const { data: sale, error } = await supabase
    .from('collection_sales')
    .insert({
      user_id: user.id,
      card_id: line.card_id,
      collection_id: collectionId,
      channel: 'manual',
      quantity,
      gross_proceeds: proceeds != null ? round2(proceeds) : null,
      fees: 0,
      net_proceeds: proceeds != null ? round2(proceeds) : null,
      cost_basis: costBasis,
      grading_company: line.grading_company,
      grade: line.grade,
      sold_at: soldAt,
      note,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: 'Failed to record sale' }, { status: 500 })

  return NextResponse.json({ ok: true, sale })
}
