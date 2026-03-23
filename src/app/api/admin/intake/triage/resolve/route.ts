import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { HOUSE_ACCOUNT_ID } from '@/types/database'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { triagePackageId, orderId, cardType, certNumber, nomiInput, consignToHouse } = await request.json()

  if (!triagePackageId) {
    return NextResponse.json({ error: 'triagePackageId is required' }, { status: 400 })
  }

  // Fetch the triage package
  const { data: pkg } = await supabase
    .from('triage_packages')
    .select('*')
    .eq('id', triagePackageId)
    .single()

  if (!pkg) {
    return NextResponse.json({ error: 'Triage package not found' }, { status: 404 })
  }

  if (pkg.status === 'resolved') {
    return NextResponse.json({ error: 'Triage package already resolved' }, { status: 400 })
  }

  const now = new Date().toISOString()
  let resolvedOrderId = orderId
  let resolvedAs: 'matched_order' | 'house_account' = 'matched_order'

  if (consignToHouse) {
    // Create a consignment order under the house account
    const cardName = nomiInput || certNumber || 'Unknown Card'
    const { data: houseOrder, error: orderErr } = await supabase
      .from('orders')
      .insert({
        buyer_id: HOUSE_ACCOUNT_ID,
        seller_id: pkg.seller_id || HOUSE_ACCOUNT_ID,
        status: 'received',
        subtotal: 0,
        shipping_cost: 0,
        platform_fee: 0,
        total: 0,
        received_at: now,
        received_via: 'triage_resolution',
        admin_notes: `[${new Date().toLocaleString()}] Consigned via triage — no matching order found. Tracking: ${pkg.tracking_number || 'N/A'}`,
        shipping_address: null,
      })
      .select()
      .single()

    if (orderErr) {
      console.error('House order creation error:', orderErr)
      return NextResponse.json({ error: 'Failed to create house account order' }, { status: 500 })
    }

    // Add the item to the house order
    await supabase.from('order_items').insert({
      order_id: houseOrder.id,
      listing_id: '00000000-0000-0000-0000-000000000000',
      card_id: certNumber || 'triage-item',
      card_name: cardName,
      quantity: 1,
      unit_price: 0,
      condition: 'near_mint',
      intake_status: 'verified',
      intake_verified_at: now,
      intake_verified_by: user.id,
      intake_notes: `Consigned from triage ${triagePackageId}`,
    })

    resolvedOrderId = houseOrder.id
    resolvedAs = 'house_account'
  } else if (orderId) {
    // Receive the order if not already received
    const { data: order } = await supabase
      .from('orders')
      .select('id, status')
      .eq('id', orderId)
      .single()

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (['paid', 'seller_shipped'].includes(order.status)) {
      await supabase
        .from('orders')
        .update({
          status: 'received',
          received_at: now,
          received_via: 'triage_resolution',
        })
        .eq('id', orderId)
    }

    resolvedAs = 'matched_order'
  } else {
    return NextResponse.json({ error: 'orderId or consignToHouse is required' }, { status: 400 })
  }

  // Update the triage package
  const { error: updateErr } = await supabase
    .from('triage_packages')
    .update({
      status: 'resolved',
      resolved_order_id: resolvedOrderId,
      resolved_as: resolvedAs,
      resolved_by: user.id,
      resolved_at: now,
      card_type: cardType || null,
      cert_number: certNumber || null,
      nomi_input: nomiInput || null,
      updated_at: now,
    })
    .eq('id', triagePackageId)

  if (updateErr) {
    console.error('Triage resolve update error:', updateErr)
    return NextResponse.json({ error: 'Failed to update triage package' }, { status: 500 })
  }

  // Log activity on the resolved order
  if (resolvedOrderId) {
    await supabase.from('intake_activity_log').insert({
      order_id: resolvedOrderId,
      action: 'triage_resolved',
      details: {
        triage_package_id: triagePackageId,
        triage_type: pkg.triage_type,
        resolved_as: resolvedAs,
        card_type: cardType,
        cert_number: certNumber,
        nomi_input: nomiInput,
      },
      performed_by: user.id,
    })
  }

  return NextResponse.json({ success: true, resolvedOrderId, resolvedAs })
}
