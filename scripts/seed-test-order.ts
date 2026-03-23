import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function seed() {
  // 1. Find all profiles to locate henry and a seller
  const { data: profiles, error: profileErr } = await supabase
    .from('profiles')
    .select('id, username, display_name, is_seller, seller_approved, stripe_account_id, stripe_onboarding_complete')
    .limit(20)

  if (profileErr) {
    console.error('Error fetching profiles:', profileErr)
    return
  }

  console.log('\n=== PROFILES ===')
  for (const p of profiles || []) {
    console.log(`  ${p.display_name || p.username || '(no name)'} [${p.id.slice(0, 8)}] seller=${p.is_seller} approved=${p.seller_approved} stripe=${!!p.stripe_account_id}`)
  }

  // Find henry
  const henry = profiles?.find(p =>
    (p.display_name || '').toLowerCase().includes('henry') ||
    (p.username || '').toLowerCase().includes('henry')
  )

  if (!henry) {
    console.log('\nCould not find henry. Available profiles above.')
    return
  }
  console.log(`\nFound henry: ${henry.display_name} [${henry.id}]`)

  // Find a seller (not henry)
  const seller = profiles?.find(p => p.is_seller && p.id !== henry.id)

  // If no other seller, use henry as both (for testing)
  const sellerProfile = seller || henry
  console.log(`Using seller: ${sellerProfile.display_name} [${sellerProfile.id}]`)

  // 2. Find an active listing (or any listing from that seller, or any listing at all)
  let { data: listings } = await supabase
    .from('listings')
    .select('id, seller_id, card_id, title, price, condition, quantity_available, photo_urls')
    .eq('status', 'active')
    .limit(5)

  if (!listings?.length) {
    // If no active listings, grab any listing
    const { data: anyListings } = await supabase
      .from('listings')
      .select('id, seller_id, card_id, title, price, condition, quantity_available, photo_urls')
      .limit(5)
    listings = anyListings
  }

  console.log('\n=== LISTINGS ===')
  for (const l of listings || []) {
    console.log(`  ${l.title} - $${l.price} [${l.id.slice(0, 8)}] seller=${l.seller_id.slice(0, 8)}`)
  }

  if (!listings?.length) {
    console.log('\nNo listings found. Creating a fake listing...')

    // Create a fake listing
    const { data: fakeListing, error: listingErr } = await supabase
      .from('listings')
      .insert({
        seller_id: sellerProfile.id,
        card_id: 'OP01-001',
        title: 'Roronoa Zoro (Leader) [OP01-001]',
        condition: 'near_mint',
        price: 12.99,
        quantity: 3,
        quantity_available: 3,
        language: 'en',
        is_first_edition: false,
        photo_urls: [],
        status: 'active',
      })
      .select()
      .single()

    if (listingErr) {
      console.error('Error creating listing:', listingErr)
      return
    }
    listings = [fakeListing]
    console.log(`Created fake listing: ${fakeListing.title}`)
  }

  // Pick a listing — prefer one NOT owned by henry so the flow makes sense
  const listing = listings.find(l => l.seller_id !== henry.id) || listings[0]
  const actualSellerId = listing.seller_id

  // Get actual seller profile
  const { data: actualSeller } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', actualSellerId)
    .single()

  console.log(`\nCreating order: henry buys "${listing.title}" from ${actualSeller?.display_name || actualSellerId.slice(0, 8)}`)

  // 3. Create the order (status = 'paid')
  const subtotal = Number(listing.price)
  const platformFee = Math.round(subtotal * 0.095 * 100) / 100
  const total = subtotal

  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .insert({
      buyer_id: henry.id,
      seller_id: actualSellerId,
      status: 'paid',
      subtotal,
      shipping_cost: 0,
      platform_fee: platformFee,
      total,
      paid_at: new Date().toISOString(),
      shipping_address: {
        name: 'Henry Test',
        line1: '123 Main Street',
        line2: 'Apt 4B',
        city: 'Los Angeles',
        state: 'CA',
        zip: '90001',
        country: 'US',
      },
    })
    .select()
    .single()

  if (orderErr) {
    console.error('Error creating order:', orderErr)
    return
  }

  console.log(`Order created: ${order.id}`)

  // 4. Create order item
  const { error: itemErr } = await supabase
    .from('order_items')
    .insert({
      order_id: order.id,
      listing_id: listing.id,
      card_id: listing.card_id,
      card_name: listing.title,
      quantity: 1,
      unit_price: listing.price,
      condition: listing.condition,
      snapshot_photo_url: listing.photo_urls?.[0] || null,
    })

  if (itemErr) {
    console.error('Error creating order item:', itemErr)
    return
  }

  console.log('\n=== DONE ===')
  console.log(`Order ID: ${order.id}`)
  console.log(`View at: http://localhost:3000/orders/${order.id}`)
  console.log(`Status: paid (seller can ship it)`)
  console.log(`Buyer: ${henry.display_name}`)
  console.log(`Seller: ${actualSeller?.display_name || 'unknown'}`)
  console.log(`Total: $${total.toFixed(2)} (fee: $${platformFee.toFixed(2)})`)
}

seed().catch(console.error)
