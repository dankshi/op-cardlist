import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getShippingRates } from '@/lib/shippo'

export async function GET(
  _request: Request,
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
    const sellerAddress = {
      name: profile.display_name || 'Seller',
      street1: profile.shipping_street1 || '',
      city: profile.shipping_city || '',
      state: profile.shipping_state || '',
      zip: profile.shipping_zip || '',
      country: 'US',
    }

    const rates = await getShippingRates(sellerAddress)

    return NextResponse.json({
      estimated_cost: rates.estimatedCost,
      carrier: rates.carrier,
      estimated_days: rates.estimatedDays,
    })
  } catch (err) {
    console.error('Rate estimation failed:', err)
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Rate estimation failed',
    }, { status: 500 })
  }
}
