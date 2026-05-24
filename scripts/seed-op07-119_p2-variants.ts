/**
 * Seed a variety pack of listings for OP07-119_p2 (Portgas.D.Ace Serial
 * Numbered — a grail card with ~$2,950 market / $9,950 TCGplayer lowest).
 * Prices here are scaled to that tier so the market-data page renders
 * realistically when developing against a higher-value variant.
 *
 *   pnpm tsx scripts/seed-op07-119_p2-variants.ts        # dry-run
 *   pnpm tsx scripts/seed-op07-119_p2-variants.ts --go   # insert
 *   pnpm tsx scripts/seed-op07-119_p2-variants.ts --undo # delete
 *
 * Sentinel in `description` so --undo only deletes what this script wrote.
 */
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const SENTINEL = '[seed-op07-119_p2-variants]'
const CARD_ID = 'OP07-119_p2'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface Plan {
  condition: 'near_mint' | 'lightly_played'
  grading_company: 'PSA' | 'BGS' | 'CGC' | 'TAG' | null
  grade: string | null
  price: number
}

// Numbers anchored on $2,950 raw market + $9,950 TCGplayer lowest, then
// shaped into a stack that gives the market drawer enough variance to
// look interesting (lowest / lowest+ / mid / premium).
const PLAN: Plan[] = [
  // Raw — a couple at-market and one ambitious.
  { condition: 'near_mint',     grading_company: null,  grade: null,               price: 2799 },
  { condition: 'near_mint',     grading_company: null,  grade: null,               price: 3100 },
  { condition: 'near_mint',     grading_company: null,  grade: null,               price: 3450 },
  { condition: 'lightly_played', grading_company: null, grade: null,               price: 2199 },

  // PSA — 10 is the prestige tier on a serialized card; 9 is also valuable.
  { grading_company: 'PSA', grade: '10',              price: 21500, condition: 'near_mint' },
  { grading_company: 'PSA', grade: '10',              price: 19999, condition: 'near_mint' },
  { grading_company: 'PSA', grade: '9',               price:  7800, condition: 'near_mint' },

  // BGS — Black Label is the crown jewel here; intentionally leave BGS 9/10 unlisted.
  { grading_company: 'BGS', grade: '9.5',             price: 11500, condition: 'near_mint' },
  { grading_company: 'BGS', grade: 'Black Label 10',  price: 45000, condition: 'near_mint' },

  // CGC — Pristine + 9.5; leave 9/10 unlisted to exercise empty-state chips.
  { grading_company: 'CGC', grade: '9.5',             price:  9800, condition: 'near_mint' },
  { grading_company: 'CGC', grade: 'Pristine 10',     price: 28000, condition: 'near_mint' },

  // TAG — single 10 so the company is represented in the chip row.
  { grading_company: 'TAG', grade: '10',              price: 13500, condition: 'near_mint' },
]

async function findSeller() {
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
  console.log(`  ${seller.display_name || seller.username} [${seller.id.slice(0, 8)}]`)

  const cardName = await getCardName()
  console.log(`\n=== Plan for ${CARD_ID} (${cardName}) ===`)
  for (const p of PLAN) {
    const variant = p.grading_company ? `${p.grading_company} ${p.grade}` : `Raw ${p.condition}`
    console.log(`  ${variant.padEnd(28)} $${p.price.toLocaleString().padStart(8)}`)
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
