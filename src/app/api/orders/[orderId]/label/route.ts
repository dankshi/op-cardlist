import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getShippingRates, createShippingLabel, PLATFORM_ADDRESS } from '@/lib/shippo'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fetch order
  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single()

  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  if (order.seller_id !== user.id) {
    return NextResponse.json({ error: 'Not your order' }, { status: 403 })
  }

  if (order.status !== 'paid') {
    return NextResponse.json({ error: 'Order is not in paid status' }, { status: 400 })
  }

  if (order.seller_label_url) {
    return NextResponse.json({ error: 'Label already generated' }, { status: 400 })
  }

  // Get seller's profile for address info
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  try {
    // Use seller's address if available, otherwise fall back to platform address
    const hasSellerAddress = profile.shipping_street1 && profile.shipping_city && profile.shipping_state && profile.shipping_zip
    const sellerAddress = hasSellerAddress
      ? {
          name: profile.display_name || 'Seller',
          street1: profile.shipping_street1,
          city: profile.shipping_city,
          state: profile.shipping_state,
          zip: profile.shipping_zip,
          country: 'US',
        }
      : { ...PLATFORM_ADDRESS, name: profile.display_name || 'Seller' }

    const rates = await getShippingRates(sellerAddress)

    // Check seller has sufficient balance
    if (Number(profile.balance) < rates.estimatedCost) {
      return NextResponse.json({
        error: `Insufficient balance. Label costs $${rates.estimatedCost.toFixed(2)} but your balance is $${Number(profile.balance).toFixed(2)}`,
      }, { status: 400 })
    }

    // Create the label
    const label = await createShippingLabel(rates.rateId)

    // Update the order with label info
    await supabase
      .from('orders')
      .update({
        seller_label_url: label.labelUrl,
        seller_label_cost: label.cost,
        seller_tracking_number: label.trackingNumber,
        seller_tracking_carrier: label.carrier,
      })
      .eq('id', orderId)

    // Deduct label cost from seller balance
    await supabase
      .from('profiles')
      .update({
        balance: Number(profile.balance) - label.cost,
      })
      .eq('id', user.id)

    return NextResponse.json({
      label_url: label.labelUrl,
      tracking_number: label.trackingNumber,
      carrier: label.carrier,
      cost: label.cost,
    })
  } catch (err) {
    console.error('Label generation failed:', err)
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Label generation failed',
    }, { status: 500 })
  }
}
