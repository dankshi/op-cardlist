/**
 * Tester cohort seed — creates a clean set of orders in every
 * status the tester needs to walk through every admin screen
 * without having to wait for a real order to progress.
 *
 * Run with:
 *   npx tsx scripts/seed-tester-cohort.ts
 *
 * Idempotent on (test_buyer_id + test_marker_in_notes). Re-running
 * skips orders that already exist and only creates missing ones.
 *
 * Creates (or reuses):
 *   - One test buyer account ("Tester Buyer")
 *   - One test seller account ("Test Seller")
 *   - Active listings on the test seller's storefront if none exist
 *   - Four test orders, each in a different lifecycle state:
 *       A. seller_shipped       → /admin/intake test
 *       B. received             → /admin/authenticate test
 *       C. authenticated        → /admin/pack test
 *       D. exception_review     → /admin/orders resolution test
 *
 * Prints every URL the tester needs at the end.
 */

import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

// Marker that lives in admin_notes so we can detect + de-dup
// previously-seeded orders without polluting any other field.
const SEED_MARKER = '[tester-cohort-seed]'

const TEST_BUYER_EMAIL = 'tester-buyer@nomimarket.test'
const TEST_SELLER_EMAIL = 'tester-seller@nomimarket.test'
const PLACEHOLDER_PHONE = '5555550199'
const BUYER_ADDRESS = {
  name: 'Tester Buyer',
  line1: '500 Terry A Francois Blvd',
  line2: 'Suite 200',
  city: 'San Francisco',
  state: 'CA',
  zip: '94158',
  country: 'US',
  phone: PLACEHOLDER_PHONE,
}

interface MinimalUser {
  id: string
  email: string
}

/** Find a user by email or create one if not found. Returns the
 *  user's auth id. Sets up the matching profile row.
 *
 *  Skips the admin listUsers API (which throws "Database error
 *  finding users" on some Supabase configurations) by:
 *    1. Looking up an existing profile by display_name first.
 *    2. Falling back to createUser, which has its own duplicate-email
 *       handling that surfaces an existing user via the error message
 *       — we re-query profiles to recover the id in that case. */
async function findOrCreateUser(email: string, displayName: string): Promise<MinimalUser> {
  // 1. Try to find via profile display_name (set by previous seed runs
  //    or by the trigger after createUser fires below).
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('display_name', displayName)
    .maybeSingle()
  if (existingProfile) {
    return { id: existingProfile.id, email }
  }

  // 2. Try to create. If the email is already registered, Supabase
  //    returns a 422 — we recover by waiting for the trigger to
  //    populate the profile then re-querying.
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    password: 'tester-seed-password-2026', // overwrite via Supabase dashboard if you need to actually sign in
    user_metadata: { display_name: displayName, source: 'tester-cohort-seed' },
  })

  if (created?.user) {
    // Profile row auto-creates via trigger; backfill display_name.
    await supabase
      .from('profiles')
      .upsert({ id: created.user.id, display_name: displayName }, { onConflict: 'id' })
    return { id: created.user.id, email }
  }

  // 3. createUser failed. If the failure was "user already exists",
  //    look the profile up again by email pattern instead. The auth
  //    schema is hidden from regular queries, but profiles.id ===
  //    auth.users.id so any prior createUser call with this email
  //    should have left a profile row. Match on the auto-generated
  //    profile we'd expect.
  const msg = createErr?.message || ''
  if (/already registered|already exists|duplicate/i.test(msg)) {
    // Re-query — a different display_name might be set, so try the
    // email as a fallback hint in profile metadata if available.
    const { data: maybeExisting } = await supabase
      .from('profiles')
      .select('id, display_name')
      .or(`display_name.eq.${displayName},display_name.ilike.%${email.split('@')[0]}%`)
      .limit(1)
      .maybeSingle()
    if (maybeExisting) {
      // Backfill the canonical display_name so future runs find it cleanly.
      await supabase
        .from('profiles')
        .update({ display_name: displayName })
        .eq('id', maybeExisting.id)
      return { id: maybeExisting.id, email }
    }
    throw new Error(
      `${email} is already a registered auth user but no matching profile was found. ` +
      `Edit the user's display_name to "${displayName}" in the Supabase dashboard, then re-run.`,
    )
  }
  throw new Error(`auth.admin.createUser failed: ${msg}`)
}

interface Listing {
  id: string
  card_id: string
  title: string
  price: number
  condition: string
  quantity_available: number
  photo_urls: string[] | null
  seller_id: string
}

async function ensureSellerHasListings(sellerId: string): Promise<Listing[]> {
  const { data: existing } = await supabase
    .from('listings')
    .select('id, card_id, title, price, condition, quantity_available, photo_urls, seller_id')
    .eq('seller_id', sellerId)
    .eq('status', 'active')
    .limit(10)
  if (existing && existing.length >= 4) return existing as Listing[]

  // Bootstrap 4 active listings on real cards from the catalog.
  // Picks the first 4 OP-prefixed cards with a price so we know
  // they're real. The pricing here is arbitrary — the test orders
  // use whatever the listings cost.
  const { data: cards } = await supabase
    .from('cards')
    .select('id, name')
    .ilike('id', 'OP%')
    .limit(20)
  if (!cards || cards.length < 4) {
    throw new Error('Not enough cards in catalog to bootstrap test listings.')
  }

  const want = 4 - (existing?.length || 0)
  const created: Listing[] = []
  for (let i = 0; i < want; i++) {
    const card = cards[i]
    const price = 25 + i * 10 // $25, $35, $45, $55 — small enough to ignore
    const { data: inserted, error } = await supabase
      .from('listings')
      .insert({
        seller_id: sellerId,
        card_id: card.id,
        title: card.name,
        price,
        condition: 'near_mint',
        quantity: 1,
        quantity_available: 1,
        status: 'active',
        language: 'EN',
        fulfillment_method: 'ship',
      })
      .select('id, card_id, title, price, condition, quantity_available, photo_urls, seller_id')
      .single()
    if (error || !inserted) {
      console.warn(`  ⚠ failed to insert listing for ${card.id}:`, error?.message)
      continue
    }
    console.log(`  + listing ${card.id} @ $${price}`)
    created.push(inserted as Listing)
  }
  return [...(existing as Listing[] || []), ...created]
}

interface MakeOrderArgs {
  scenarioKey: string  // unique tag so we can de-dup
  scenarioLabel: string
  buyerId: string
  sellerId: string
  listing: Listing
  status: 'seller_shipped' | 'received' | 'authenticated' | 'exception_review'
}

async function makeOrder(args: MakeOrderArgs): Promise<{ id: string; created: boolean }> {
  const marker = `${SEED_MARKER} ${args.scenarioKey}`

  // De-dup: skip if an existing order already carries this marker.
  const { data: existing } = await supabase
    .from('orders')
    .select('id, status')
    .eq('buyer_id', args.buyerId)
    .ilike('admin_notes', `%${marker}%`)
    .maybeSingle()
  if (existing) {
    return { id: existing.id, created: false }
  }

  const subtotal = Number(args.listing.price)
  const shippingCost = 5.00
  const platformFee = Math.round(subtotal * 0.095 * 100) / 100
  const total = subtotal + shippingCost
  const now = new Date()

  // Build status-specific timestamps. Each later state implies all
  // prior timestamps were set.
  const paidAt = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)  // 3 days ago
  const shippedAt = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)
  const receivedAt = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000)
  const authenticatedAt = new Date(now.getTime() - 6 * 60 * 60 * 1000)

  const orderData: Record<string, unknown> = {
    buyer_id: args.buyerId,
    seller_id: args.sellerId,
    status: args.status,
    subtotal,
    shipping_cost: shippingCost,
    platform_fee: platformFee,
    total,
    paid_at: paidAt.toISOString(),
    shipping_address: BUYER_ADDRESS,
    admin_notes: `[${now.toLocaleString('en-US')}] Seeded: ${args.scenarioLabel}\n${marker}`,
    inventory_reserved: true,
  }

  if (args.status === 'seller_shipped' || args.status === 'received' ||
      args.status === 'authenticated' || args.status === 'exception_review') {
    orderData.shipped_at = shippedAt.toISOString()
    orderData.seller_tracking_number = `9405511899223${Math.floor(Math.random() * 1000000000)}`
    orderData.seller_tracking_carrier = 'USPS'
  }
  if (args.status === 'received' || args.status === 'authenticated' || args.status === 'exception_review') {
    orderData.received_at = receivedAt.toISOString()
  }
  if (args.status === 'authenticated') {
    orderData.authenticated_at = authenticatedAt.toISOString()
  }

  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .insert(orderData)
    .select('id')
    .single()
  if (orderErr || !order) {
    throw new Error(`order insert failed for ${args.scenarioKey}: ${orderErr?.message}`)
  }

  // Build per-item state. For most scenarios, one item with default
  // intake/auth values. exception_review needs a flagged item.
  const orderItem: Record<string, unknown> = {
    order_id: order.id,
    listing_id: args.listing.id,
    card_id: args.listing.card_id,
    card_name: args.listing.title,
    quantity: 1,
    unit_price: args.listing.price,
    condition: args.listing.condition,
    snapshot_photo_url: args.listing.photo_urls?.[0] || null,
  }

  if (args.status === 'received' || args.status === 'authenticated') {
    // Items in 'received' must be verifiable. 'authenticated' implies
    // the auth flow already succeeded for them.
    orderItem.intake_status = 'verified'
    orderItem.intake_verified_at = receivedAt.toISOString()
  }
  if (args.status === 'authenticated') {
    orderItem.auth_decision = 'authentic'
    orderItem.auth_condition = 'near_mint'
    orderItem.auth_decided_at = authenticatedAt.toISOString()
  }
  if (args.status === 'exception_review') {
    // Conditional exception — Lightly Played downgrade. Tester sees
    // the resolution UI fire with a consignment-price input.
    orderItem.intake_status = 'verified'
    orderItem.intake_verified_at = receivedAt.toISOString()
    orderItem.auth_decision = 'authentic'
    orderItem.auth_condition = 'exception'
    orderItem.exception_types = ['conditional']
    orderItem.exception_details = {
      conditional: {
        actual_condition: 'lightly_played',
        damage_areas: ['corners', 'edges'],
      },
    }
    orderItem.auth_decided_at = authenticatedAt.toISOString()
  }

  const { data: insertedItem, error: itemErr } = await supabase
    .from('order_items')
    .insert(orderItem)
    .select('id')
    .single()
  if (itemErr || !insertedItem) {
    throw new Error(`order_item insert failed for ${args.scenarioKey}: ${itemErr?.message}`)
  }

  // For exception_review, also seed the consignment submission + item
  // that finalize-auth would have written (unified consignment model,
  // channel='exception'). Otherwise the resolution UI shows the order
  // but the per-item consignment-price input has no row to update.
  if (args.status === 'exception_review') {
    const { data: sub } = await supabase
      .from('consignment_submissions')
      .insert({
        seller_id: args.sellerId,
        channel: 'exception',
        status: 'processing',
        origin_order_id: order.id,
      })
      .select('id')
      .single()
    if (sub) {
      await supabase.from('consignment_items').insert({
        submission_id: sub.id,
        seller_id: args.sellerId,
        card_id: orderItem.card_id,
        kind: 'raw',
        origin_order_item_id: insertedItem.id,
        exception_type: 'conditional',
        status: 'confirmed',
        notes: 'Seeded for tester cohort — Lightly Played downgrade',
      })
    }
  }

  return { id: order.id, created: true }
}

async function main() {
  console.log('🌱 Seeding tester cohort...\n')

  // 1. Test users
  console.log('Ensuring test users exist...')
  const buyer = await findOrCreateUser(TEST_BUYER_EMAIL, 'Tester Buyer')
  const seller = await findOrCreateUser(TEST_SELLER_EMAIL, 'Test Seller')
  console.log(`  buyer:  ${buyer.email} (${buyer.id.slice(0, 8)})`)
  console.log(`  seller: ${seller.email} (${seller.id.slice(0, 8)})`)

  // Make the seller actually a seller.
  await supabase
    .from('profiles')
    .update({ is_seller: true, seller_approved: true, display_name: 'Test Seller' })
    .eq('id', seller.id)

  // Make the buyer's profile have a sensible display name.
  await supabase
    .from('profiles')
    .update({ display_name: 'Tester Buyer' })
    .eq('id', buyer.id)

  // 2. Listings
  console.log('\nEnsuring seller has active listings...')
  const listings = await ensureSellerHasListings(seller.id)
  if (listings.length < 4) {
    console.error(`Need at least 4 active listings, got ${listings.length}. Bailing.`)
    return
  }
  console.log(`  ${listings.length} active listings ready`)

  // 3. Orders — one per status.
  console.log('\nCreating test orders...')
  const scenarios: Array<{ key: string; label: string; status: MakeOrderArgs['status']; listing: Listing }> = [
    { key: 'A_seller_shipped',   label: 'A — Seller shipped (intake test)',          status: 'seller_shipped',   listing: listings[0] },
    { key: 'B_received',         label: 'B — Received (authentication test)',         status: 'received',         listing: listings[1] },
    { key: 'C_authenticated',    label: 'C — Authenticated (pack test)',              status: 'authenticated',    listing: listings[2] },
    { key: 'D_exception_review', label: 'D — Exception review (resolution test)',     status: 'exception_review', listing: listings[3] },
  ]

  const summaries: Array<{ scenario: string; status: string; id: string; created: boolean; url: string }> = []
  for (const s of scenarios) {
    try {
      const { id, created } = await makeOrder({
        scenarioKey: s.key,
        scenarioLabel: s.label,
        buyerId: buyer.id,
        sellerId: seller.id,
        listing: s.listing,
        status: s.status,
      })
      console.log(`  ${created ? '+' : '·'} ${s.label} → #${id.slice(0, 8)}${created ? '' : ' (already existed)'}`)
      summaries.push({
        scenario: s.label,
        status: s.status,
        id,
        created,
        url: `${SITE_URL}/admin/orders/${id}`,
      })
    } catch (err) {
      console.error(`  ✗ ${s.label}:`, err)
    }
  }

  // 4. Pretty print the handoff sheet for the tester.
  console.log('\n' + '═'.repeat(72))
  console.log('TESTER HANDOFF')
  console.log('═'.repeat(72))
  console.log(`\nAdmin dashboard:       ${SITE_URL}/admin`)
  console.log(`Test buyer login:      ${buyer.email}  (password: tester-seed-password-2026)`)
  console.log(`Test seller login:     ${seller.email}  (same password)`)
  console.log(`\nFour orders, ready to walk through every flow:\n`)
  for (const s of summaries) {
    console.log(`  ${s.scenario}`)
    console.log(`    status:  ${s.status}`)
    console.log(`    id:      ${s.id}`)
    console.log(`    detail:  ${s.url}`)
    console.log('')
  }
  console.log('Setup notes + scenario walk-throughs: designs/tester-handoff.md')
  console.log('═'.repeat(72))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
