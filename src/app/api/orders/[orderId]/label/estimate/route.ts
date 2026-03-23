import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getShippingRates, PLATFORM_ADDRESS } from '@/lib/shippo'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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

  // Get seller's profile for address
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
          email: profile.shipping_email || user.email || PLATFORM_ADDRESS.email,
          phone: profile.shipping_phone || PLATFORM_ADDRESS.phone,
        }
      : { ...PLATFORM_ADDRESS, name: profile.display_name || 'Seller' }

    // Auto-add insurance for high-value orders (nomi covers the cost)
    const HIGH_VALUE_THRESHOLD = 500
    const orderTotal = Number(order.total)
    const insuranceOptions = orderTotal >= HIGH_VALUE_THRESHOLD
      ? { insuranceAmount: orderTotal }
      : undefined

    const rates = await getShippingRates(sellerAddress, insuranceOptions)

    return NextResponse.json({
      from_address: {
        city: sellerAddress.city,
        state: sellerAddress.state,
        zip: sellerAddress.zip,
      },
      rates: rates.map(r => ({
        rate_id: r.rateId,
        carrier: r.carrier,
        service: r.service,
        estimated_cost: r.estimatedCost,
        estimated_days: r.estimatedDays,
      })),
    })
  } catch (err) {
    console.error('Rate estimation failed:', err)
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Rate estimation failed',
    }, { status: 500 })
  }
}
