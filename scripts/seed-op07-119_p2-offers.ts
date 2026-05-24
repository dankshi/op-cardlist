/**
 * Seed dummy offers (bids) for OP07-119_p2 across raw + graded variants.
 * Mirrors seed-op07-119-offers.ts but with bigger numbers — this card's
 * raw market is ~$2,950 so $20 offers would be noise.
 *
 *   pnpm tsx scripts/seed-op07-119_p2-offers.ts        # dry-run
 *   pnpm tsx scripts/seed-op07-119_p2-offers.ts --go   # insert
 *   pnpm tsx scripts/seed-op07-119_p2-offers.ts --undo # delete
 *
 * Sentinel via fixed-future expires_at so --undo only deletes our rows.
 */
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const CARD_ID = 'OP07-119_p2'
const SENTINEL_EXPIRES = '2099-12-30T00:00:00Z' // distinct from the OP07-119 seed sentinel

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface Plan {
  grading_company: 'PSA' | 'BGS' | 'CGC' | 'TAG' | null
  grade: string | null
  price: number
}

// Each offer sits below the matching lowest listing — UI filters out
// offers ≥ lowest ask, so anything we'd want visible has to undercut.
const PLAN: Plan[] = [
  // Raw — three undercutting the $2,799 floor.
  { grading_company: null,  grade: null,               price: 2500 },
  { grading_company: null,  grade: null,               price: 2200 },
  { grading_company: null,  grade: null,               price: 1900 },

  // PSA 10 — two below the $19,999 floor.
  { grading_company: 'PSA', grade: '10',               price: 17500 },
  { grading_company: 'PSA', grade: '10',               price: 15800 },

  // PSA 9 — below the $7,800 floor.
  { grading_company: 'PSA', grade: '9',                price: 6500 },

  // BGS Black Label 10 — speculative below the $45k floor.
  { grading_company: 'BGS', grade: 'Black Label 10',   price: 38000 },

  // BGS 10 — no listings (speculative offer at a price someone might list at).
  { grading_company: 'BGS', grade: '10',               price: 14000 },

  // BGS 9.5 — below the $11,500 floor.
  { grading_company: 'BGS', grade: '9.5',              price: 9500 },

  // CGC Pristine 10 — below the $28k floor.
  { grading_company: 'CGC', grade: 'Pristine 10',      price: 24500 },

  // CGC 9.5 — below the $9,800 floor.
  { grading_company: 'CGC', grade: '9.5',              price: 8200 },

  // TAG 10 — below the $13,500 floor.
  { grading_company: 'TAG', grade: '10',               price: 11000 },
]

async function findBuyer() {
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
    const variant = p.grading_company ? `${p.grading_company} ${p.grade}` : 'Ungraded NM'
    console.log(`  ${variant.padEnd(28)} $${p.price.toLocaleString().padStart(8)}`)
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
    stripe_payment_intent_id: null,
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
