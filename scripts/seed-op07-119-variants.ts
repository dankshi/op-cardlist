/**
 * Seed a variety pack of listings for OP07-119 (Boa Hancock SR) so the
 * market-data page has interesting Raw + graded mixed inventory to render.
 *
 *   pnpm tsx scripts/seed-op07-119-variants.ts        # dry-run
 *   pnpm tsx scripts/seed-op07-119-variants.ts --go   # insert
 *   pnpm tsx scripts/seed-op07-119-variants.ts --undo # delete
 *
 * Sentinel in `description` so --undo only deletes what this script wrote.
 */
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const SENTINEL = '[seed-op07-119-variants]'
const CARD_ID = 'OP07-119'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface Plan {
  label: string
  condition: 'near_mint' | 'lightly_played'
  grading_company: 'PSA' | 'BGS' | 'CGC' | 'TAG' | null
  grade: string | null
  price: number
}

// Sized so the ladder has clear separation: raw cluster around $25–$35,
// PSA 10 is the prestige tier, lower grades scale down sensibly.
const PLAN: Plan[] = [
  // Raw — three sellers at near-NM pricing with a small spread
  { label: 'Raw NM',          condition: 'near_mint',     grading_company: null,  grade: null,  price: 24.99 },
  { label: 'Raw NM',          condition: 'near_mint',     grading_company: null,  grade: null,  price: 27.50 },
  { label: 'Raw NM',          condition: 'near_mint',     grading_company: null,  grade: null,  price: 31.00 },
  { label: 'Raw LP',          condition: 'lightly_played', grading_company: null,  grade: null,  price: 19.00 },

  // PSA — only 10 and 9 (PSA grades in integers; no 9.5).
  { label: 'PSA 10',          condition: 'near_mint',     grading_company: 'PSA', grade: '10',  price: 215.00 },
  { label: 'PSA 10 (lower)',  condition: 'near_mint',     grading_company: 'PSA', grade: '10',  price: 199.00 },
  { label: 'PSA 9',           condition: 'near_mint',     grading_company: 'PSA', grade: '9',   price: 79.00 },

  // BGS — top-of-line + 9.5. Intentionally leave BGS 9 and BGS 10
  // unlisted so the chip row has empty-state cases to render.
  { label: 'BGS 9.5',         condition: 'near_mint',     grading_company: 'BGS', grade: '9.5', price: 120.00 },
  { label: 'BGS Black Label 10', condition: 'near_mint',  grading_company: 'BGS', grade: 'Black Label 10', price: 480.00 },

  // CGC — Pristine 10 and 9.5; leave 9 and 10 unlisted.
  { label: 'CGC 9.5',         condition: 'near_mint',     grading_company: 'CGC', grade: '9.5', price: 105.00 },
  { label: 'CGC Pristine 10', condition: 'near_mint',     grading_company: 'CGC', grade: 'Pristine 10', price: 320.00 },

  // TAG — single 10 so the company is represented but most TAG grades
  // are unlisted, exercising the "empty company column" path.
  { label: 'TAG 10',          condition: 'near_mint',     grading_company: 'TAG', grade: '10',  price: 140.00 },
]

async function findSeller() {
  // Same seed-target convention as scripts/seed-nomitest-listings.ts —
  // the existing approved-seller test profile (display_name='test').
  const { data } = await supabase
    .from('profiles')
    .select('id, display_name, username, is_seller, seller_approved')
    .eq('display_name', 'test')
    .limit(1)
  return data?.[0]
}

async function getCardName(): Promise<string> {
  const { data } = await supabase.from('cards').select('name').eq('id', CARD_ID).single()
  return data?.name ?? CARD_ID
}

async function dryRun() {
  const seller = await findSeller()
  console.log('\n=== Seller lookup ===')
  if (!seller) {
    console.log("  No 'test' seller profile found. Aborting.")
    return null
  }
  console.log(`  ${seller.display_name || seller.username} [${seller.id.slice(0, 8)}] seller=${seller.is_seller} approved=${seller.seller_approved}`)

  const cardName = await getCardName()
  console.log(`\n=== Plan for ${CARD_ID} (${cardName}) ===`)
  for (const p of PLAN) {
    const variant = p.grading_company ? `${p.grading_company} ${p.grade}` : `Raw ${p.condition}`
    console.log(`  ${variant.padEnd(28)} $${p.price.toFixed(2).padStart(7)}`)
  }
  console.log(`\n  Total rows: ${PLAN.length}`)
  console.log(`  Sentinel:   "${SENTINEL}" (used by --undo)`)
  console.log('\n  Re-run with --go to insert.')
  return { seller, cardName }
}

async function go() {
  const result = await dryRun()
  if (!result) return
  const { seller, cardName } = result

  // Promote test seller if needed.
  await supabase
    .from('profiles')
    .update({ is_seller: true, seller_approved: true })
    .eq('id', seller.id)

  const rows = PLAN.map(p => {
    const variantSuffix = p.grading_company ? ` (${p.grading_company} ${p.grade})` : ` (${p.condition === 'near_mint' ? 'NM' : 'LP'})`
    return {
      seller_id: seller.id,
      card_id: CARD_ID,
      title: `${cardName}${variantSuffix}`,
      description: SENTINEL,
      condition: p.condition,
      grading_company: p.grading_company,
      grade: p.grade,
      price: p.price,
      quantity: 1,
      quantity_available: 1,
      language: 'EN',
      is_first_edition: false,
      photo_urls: [],
      status: 'active',
    }
  })

  const { error } = await supabase.from('listings').insert(rows)
  if (error) {
    console.error('\nInsert failed:', error)
    return
  }
  console.log(`\n✓ Inserted ${rows.length} variant listings for ${CARD_ID}.`)
}

async function undo() {
  const { data, error } = await supabase
    .from('listings')
    .delete()
    .eq('description', SENTINEL)
    .eq('card_id', CARD_ID)
    .select('id')

  if (error) {
    console.error('Undo failed:', error)
    return
  }
  console.log(`✓ Removed ${data?.length ?? 0} seeded listings for ${CARD_ID}.`)
}

const arg = process.argv[2]
if (arg === '--go') {
  go().catch(console.error)
} else if (arg === '--undo') {
  undo().catch(console.error)
} else {
  dryRun().catch(console.error)
}
