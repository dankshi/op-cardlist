/**
 * Seed test listings under the `nomitest` account so we can eyeball the
 * "X listings from $Y" line on set + search tiles.
 *
 * Modes:
 *   pnpm tsx scripts/seed-nomitest-listings.ts        # dry-run: prints plan
 *   pnpm tsx scripts/seed-nomitest-listings.ts --go   # actually inserts
 *   pnpm tsx scripts/seed-nomitest-listings.ts --undo # deletes test rows
 *
 * Test rows are tagged with a sentinel string in `description` so --undo
 * only removes what this script created (never touches real listings).
 */
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const SENTINEL = '[seed-nomitest-listings]'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface Plan {
  cardId: string
  cardName: string
  marketPrice: number | null
  asks: { price: number; quantity: number }[]
}

async function findNomitest() {
  // Profile "nomitest" doesn't literally exist — user picked the existing
  // approved-seller test profile (display_name='test', id starts 1d644bed).
  const { data } = await supabase
    .from('profiles')
    .select('id, username, display_name, is_seller, seller_approved')
    .eq('display_name', 'test')

  return data ?? []
}

async function pickCards(): Promise<Plan[]> {
  // Variety pack: a few grails (SP / TR / manga), a few high-market base
  // cards, and one cheaper card so we cover the spread. All real card IDs
  // from the catalog; lowest-ask is set relative to market so the line
  // reads sensibly (sometimes below market = bargain, sometimes above).
  const candidateIds = [
    'OP13-118_p1', // Luffy Red SP (the Grail screenshot)
    'OP01-001_p1', // Roronoa Zoro alt
    'OP02-001_p1',
    'OP05-119',
    'OP09-001_p1',
    'OP11-001_p1',
    'EB01-006_p1',
    'OP07-119',
    'OP08-001',
    'PRB-01-001',
  ]

  const { data: cards } = await supabase
    .from('cards')
    .select('id, name')
    .in('id', candidateIds)

  const { data: mappings } = await supabase
    .from('card_tcgplayer_mapping')
    .select('card_id, tcgplayer_product_id')
    .in('card_id', candidateIds)

  const productIds = (mappings ?? []).map(m => m.tcgplayer_product_id).filter(Boolean) as number[]
  const { data: prices } = await supabase
    .from('tcgplayer_current_prices')
    .select('tcgplayer_product_id, market_price')
    .in('tcgplayer_product_id', productIds)

  const priceByProduct = new Map<number, number>()
  for (const p of prices ?? []) {
    if (p.market_price != null) priceByProduct.set(p.tcgplayer_product_id, Number(p.market_price))
  }
  const productByCard = new Map<string, number>()
  for (const m of mappings ?? []) {
    if (m.tcgplayer_product_id != null) productByCard.set(m.card_id, m.tcgplayer_product_id)
  }

  // Asks shape per card: varied counts (1, 2, 3, 5) and prices relative
  // to market so the resulting "X listings from $Y" line is realistic.
  const askShapes: Array<{ count: number; relMultipliers: number[] }> = [
    { count: 1, relMultipliers: [1.10] },          // single ask just above market
    { count: 2, relMultipliers: [0.95, 1.20] },    // bargain + premium
    { count: 3, relMultipliers: [1.05, 1.15, 1.40] },
    { count: 1, relMultipliers: [0.85] },          // bargain ask
    { count: 5, relMultipliers: [0.90, 1.00, 1.10, 1.25, 1.50] },
    { count: 2, relMultipliers: [1.00, 1.30] },
    { count: 3, relMultipliers: [0.95, 1.10, 1.25] },
    { count: 1, relMultipliers: [1.20] },
    { count: 4, relMultipliers: [0.80, 1.00, 1.15, 1.45] },
    { count: 2, relMultipliers: [1.05, 1.35] },
  ]

  const plans: Plan[] = []
  ;(cards ?? []).forEach((c, idx) => {
    const productId = productByCard.get(c.id)
    const market = productId != null ? priceByProduct.get(productId) ?? null : null
    // If no market price, fall back to a synthetic anchor so the math is sane.
    const anchor = market ?? 25
    const shape = askShapes[idx % askShapes.length]
    const asks = shape.relMultipliers.map(m => ({
      price: Math.max(0.99, Math.round(anchor * m * 100) / 100),
      quantity: 1,
    }))
    plans.push({ cardId: c.id, cardName: c.name, marketPrice: market, asks })
  })

  return plans
}

async function dryRun() {
  const profiles = await findNomitest()
  console.log('\n=== NOMITEST PROFILE LOOKUP ===')
  if (profiles.length === 0) {
    console.log('  No profile matched "nomitest". Aborting.')
    return null
  }
  for (const p of profiles) {
    console.log(`  ${p.display_name || p.username} [${p.id.slice(0, 8)}] seller=${p.is_seller} approved=${p.seller_approved}`)
  }
  const target = profiles[0]
  console.log(`\n  → Using: ${target.display_name || target.username} [${target.id}]`)

  const plans = await pickCards()
  console.log('\n=== SEED PLAN ===')
  let totalRows = 0
  for (const p of plans) {
    const lowest = Math.min(...p.asks.map(a => a.price))
    console.log(
      `  ${p.cardId.padEnd(16)} ${(p.cardName || '').slice(0, 28).padEnd(28)} ` +
      `market=${p.marketPrice != null ? `$${p.marketPrice.toFixed(2)}`.padStart(9) : '       —'}  ` +
      `${p.asks.length} ask(s) from $${lowest.toFixed(2)}`,
    )
    totalRows += p.asks.length
  }
  console.log(`\n  Total rows to insert: ${totalRows}`)
  console.log(`  Sentinel: "${SENTINEL}" (used by --undo)`)
  console.log('\n  Re-run with --go to insert.')

  return { target, plans }
}

async function go() {
  const result = await dryRun()
  if (!result) return
  const { target, plans } = result

  // Auto-promote nomitest to a verified seller if needed (test account).
  await supabase
    .from('profiles')
    .update({ is_seller: true, seller_approved: true })
    .eq('id', target.id)

  const rows: Array<Record<string, unknown>> = []
  for (const p of plans) {
    for (const ask of p.asks) {
      rows.push({
        seller_id: target.id,
        card_id: p.cardId,
        title: p.cardName,
        description: SENTINEL,
        condition: 'near_mint',
        price: ask.price,
        quantity: ask.quantity,
        quantity_available: ask.quantity,
        language: 'EN',
        is_first_edition: false,
        photo_urls: [],
        status: 'active',
      })
    }
  }

  const { error } = await supabase.from('listings').insert(rows)
  if (error) {
    console.error('\nInsert failed:', error)
    return
  }
  console.log(`\n✓ Inserted ${rows.length} test listings under ${target.display_name || target.username}.`)
}

async function undo() {
  const { data, error } = await supabase
    .from('listings')
    .delete()
    .eq('description', SENTINEL)
    .select('id')

  if (error) {
    console.error('Undo failed:', error)
    return
  }
  console.log(`✓ Removed ${data?.length ?? 0} seeded test listings.`)
}

const arg = process.argv[2]
if (arg === '--go') {
  go().catch(console.error)
} else if (arg === '--undo') {
  undo().catch(console.error)
} else {
  dryRun().catch(console.error)
}
