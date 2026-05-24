/**
 * Seed dummy offers (bids) for OP07-119 across raw + graded variants so
 * the market-data Offers tab + the bid stack on the Offer form have data
 * to render in dev.
 *
 *   pnpm tsx scripts/seed-op07-119-offers.ts        # dry-run
 *   pnpm tsx scripts/seed-op07-119-offers.ts --go   # insert
 *   pnpm tsx scripts/seed-op07-119-offers.ts --undo # delete
 *
 * Bids carry no description column we can sentinel, so --undo identifies
 * seeded rows by (user_id = test-buyer, card_id = OP07-119) and a fixed
 * expires_at sentinel timestamp far in the future that we set on insert.
 */
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const CARD_ID = 'OP07-119'
// Sentinel expires_at — used as the marker for --undo. Pick a date far
// enough in the future that a real user is extremely unlikely to set it.
const SENTINEL_EXPIRES = '2099-12-31T00:00:00Z'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface Plan {
  grading_company: 'PSA' | 'BGS' | 'CGC' | 'TAG' | null
  grade: string | null
  price: number
}

// Offers sized below the matching lowest-listing so they look like
// realistic "I'd buy at this price" bids — about 70-85% of the listed
// floor where one exists, otherwise a reasonable speculative price.
const PLAN: Plan[] = [
  // Raw — three offers stacked below the cheapest raw listing ($19).
  { grading_company: null,  grade: null,               price: 15.00 },
  { grading_company: null,  grade: null,               price: 12.50 },
  { grading_company: null,  grade: null,               price: 10.00 },

  // PSA 10 — two offers below the $199 floor.
  { grading_company: 'PSA', grade: '10',               price: 170.00 },
  { grading_company: 'PSA', grade: '10',               price: 155.00 },

  // PSA 9 — one offer below the $79 floor.
  { grading_company: 'PSA', grade: '9',                price: 60.00 },

  // BGS Black Label 10 — premium speculative offer below the $480 floor.
  { grading_company: 'BGS', grade: 'Black Label 10',   price: 400.00 },

  // BGS 10 — no listings, so offer is purely speculative.
  { grading_company: 'BGS', grade: '10',               price: 130.00 },

  // BGS 9.5 — below the $120 floor.
  { grading_company: 'BGS', grade: '9.5',              price: 95.00 },

  // CGC Pristine 10 — below the $320 floor.
  { grading_company: 'CGC', grade: 'Pristine 10',      price: 275.00 },

  // CGC 9.5 — below the $105 floor.
  { grading_company: 'CGC', grade: '9.5',              price: 85.00 },

  // TAG 10 — below the $140 floor.
  { grading_company: 'TAG', grade: '10',               price: 110.00 },
]

async function findBuyer() {
  // Use the same 'test' profile that owns the seeded listings. The
  // BidAskSpread component prevents self-acceptance UI-side, but for
  // dummy-data purposes this is fine and matches the existing setup.
  const { data } = await supabase
    .from('profiles')
    .select('id, display_name, username')
    .eq('display_name', 'test')
    .limit(1)
  return data?.[0]
}

async function dryRun() {
  const buyer = await findBuyer()
  console.log('\n=== Buyer lookup ===')
  if (!buyer) {
    console.log("  No 'test' profile found. Aborting.")
    return null
  }
  console.log(`  ${buyer.display_name || buyer.username} [${buyer.id.slice(0, 8)}]`)

  console.log(`\n=== Plan for ${CARD_ID} offers ===`)
  for (const p of PLAN) {
    const variant = p.grading_company ? `${p.grading_company} ${p.grade}` : 'Raw NM'
    console.log(`  ${variant.padEnd(28)} $${p.price.toFixed(2).padStart(7)}`)
  }
  console.log(`\n  Total rows: ${PLAN.length}`)
  console.log(`  Sentinel expires_at: ${SENTINEL_EXPIRES} (used by --undo)`)
  console.log('\n  Re-run with --go to insert.')
  return { buyer }
}

async function go() {
  const result = await dryRun()
  if (!result) return
  const { buyer } = result

  const rows = PLAN.map(p => ({
    user_id: buyer.id,
    card_id: CARD_ID,
    price: p.price,
    quantity: 1,
    condition_min: 'near_mint' as const,
    grading_company: p.grading_company,
    grade: p.grade,
    status: 'active' as const,
    expires_at: SENTINEL_EXPIRES,
    stripe_payment_intent_id: null, // legacy-style bid; sell-into-offer route still works
  }))

  const { error } = await supabase.from('bids').insert(rows)
  if (error) {
    console.error('\nInsert failed:', error)
    return
  }
  console.log(`\n✓ Inserted ${rows.length} offers for ${CARD_ID}.`)
}

async function undo() {
  const { data, error } = await supabase
    .from('bids')
    .delete()
    .eq('card_id', CARD_ID)
    .eq('expires_at', SENTINEL_EXPIRES)
    .select('id')

  if (error) {
    console.error('Undo failed:', error)
    return
  }
  console.log(`✓ Removed ${data?.length ?? 0} seeded offers for ${CARD_ID}.`)
}

const arg = process.argv[2]
if (arg === '--go') {
  go().catch(console.error)
} else if (arg === '--undo') {
  undo().catch(console.error)
} else {
  dryRun().catch(console.error)
}
