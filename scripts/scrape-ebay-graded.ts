// Scrape eBay sold listings for graded card sales.
//
// Sold listings url pattern:
//   https://www.ebay.com/sch/i.html?_nkw=<query>&LH_Sold=1&LH_Complete=1&_sop=13
//   _sop=13 → sort by ended-recently first
//
// Usage:
//   npx tsx scripts/scrape-ebay-graded.ts <cardId>              # one card
//   npx tsx scripts/scrape-ebay-graded.ts --threshold 20        # all cards with market_price >= $20
//   npx tsx scripts/scrape-ebay-graded.ts --all                 # everything (slow)
//   npx tsx scripts/scrape-ebay-graded.ts --dry-run             # don't write to DB
//
// This is a scaffold — eBay's HTML changes, and title parsing has many
// edge cases. Run it on one card first, eyeball the parsed output, then
// iterate.

import puppeteerExtra from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import type { Browser, Page } from 'puppeteer'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

puppeteerExtra.use(StealthPlugin())

dotenv.config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const POLITE_DELAY_MS = 2500
const PAGE_TIMEOUT_MS = 30_000

type GradingCompany = 'PSA' | 'CGC' | 'BGS' | 'TAG'

interface ParsedSale {
  gradingCompany: GradingCompany
  grade: string
  price: number
  soldAt: Date
  title: string
  ebayItemId: string | null
  listingUrl: string | null
  parseConfidence: 'high' | 'low'
}

// ─────────────────────────────────────────────────────────────────────
// Title parsing
// ─────────────────────────────────────────────────────────────────────

/**
 * Extract grading company + grade from an eBay listing title.
 * Returns null if no grade is found (i.e. this is likely a raw card).
 *
 * Conservative: if two different companies/grades appear in the title
 * (likely a bundle or lot), we skip rather than guess.
 */
export function parseGradeFromTitle(title: string): { company: GradingCompany; grade: string } | null {
  const upper = title.toUpperCase()

  // Special-case BGS Black Label = 10
  if (/\bBGS\b.*\bBLACK\s*LABEL\b|\bBLACK\s*LABEL\b.*\bBGS\b/.test(upper)) {
    return { company: 'BGS', grade: '10' }
  }

  // Standard pattern: <COMPANY> [optional adjective like GEM MINT] <grade>
  // grade = 10, 9.5, 9, 8.5, 8, ... down to 1
  const pattern = /\b(PSA|CGC|BGS|TAG)\s*(?:GEM\s*MINT|MINT|NM-MT|PRISTINE|GRADE)?\s*(10(?:\.0)?|[1-9](?:\.5)?)\b/g
  const matches: { company: GradingCompany; grade: string }[] = []
  let m: RegExpExecArray | null
  while ((m = pattern.exec(upper))) {
    const grade = m[2].replace(/\.0$/, '')
    matches.push({ company: m[1] as GradingCompany, grade })
  }

  // Also catch TAG Pristine 10 written without "TAG"
  if (matches.length === 0 && /\bPRISTINE\s*10\b/.test(upper)) {
    return { company: 'TAG', grade: '10' }
  }

  if (matches.length === 0) return null

  // If multiple, all must match (e.g. "PSA 10" appearing twice). Otherwise it's a bundle.
  const first = matches[0]
  for (const x of matches) {
    if (x.company !== first.company || x.grade !== first.grade) return null
  }
  return first
}

/**
 * Heuristic confidence that a single-slab grade parse is trustworthy. Returns
 * 'low' for titles that smell like multi-item / non-standard listings (lots,
 * bundles, proxies, custom/repack), which the /admin/slab-sales queue surfaces
 * with a "parse?" badge so an admin can eyeball + exclude them. Conservative —
 * the comp trim already drops most price outliers; this just routes the
 * suspicious rows to human review.
 */
export function parseConfidence(title: string): 'high' | 'low' {
  const t = title.toLowerCase()
  if (/\b(lot|lots|bundle|bulk|repack|reprint|proxy|custom|sticker|digital|playset|joblot)\b/.test(t)) return 'low'
  if (/\b(lot|set)\s+of\b/.test(t)) return 'low'         // "lot of", "set of"
  if (/\bx\s?[2-9]\d*\b/.test(t)) return 'low'            // "x2", "x 10"
  if (/\(\s*[2-9]\d*\s*(pcs|cards|count|ct)?\s*\)/.test(t)) return 'low' // "(2)", "(3 cards)"
  return 'high'
}

/**
 * Parse eBay's "Sold" date format. Examples seen:
 *   "Sold  Mar 5, 2026"
 *   "Sold  Yesterday"
 *   "Sold  Today"
 */
export function parseEbaySoldDate(raw: string, now: Date = new Date()): Date | null {
  const cleaned = raw.replace(/^sold\s+/i, '').trim()
  if (/^today/i.test(cleaned)) return now
  if (/^yesterday/i.test(cleaned)) {
    const d = new Date(now)
    d.setDate(d.getDate() - 1)
    return d
  }
  const d = new Date(cleaned)
  return isNaN(d.getTime()) ? null : d
}

/**
 * Pull eBay's numeric item id out of a listing URL.
 *   /itm/123456789012  → "123456789012"
 *   /itm/some-title/123456789012  → "123456789012"
 */
export function parseEbayItemId(url: string): string | null {
  const m = url.match(/\/itm\/(?:[^/]+\/)?(\d{10,})/)
  return m ? m[1] : null
}

/**
 * eBay sometimes shows price ranges like "$12.99 to $24.99" for variations.
 * Pick the lower bound (conservative).
 */
export function parsePrice(raw: string): number | null {
  const m = raw.match(/\$\s*(\d{1,5}(?:,\d{3})*(?:\.\d{2})?)/)
  if (!m) return null
  return parseFloat(m[1].replace(/,/g, ''))
}

// ─────────────────────────────────────────────────────────────────────
// Scraping
// ─────────────────────────────────────────────────────────────────────

async function scrapeCardSoldListings(
  page: Page,
  query: string,
  debugDump = false,
): Promise<{ title: string; priceText: string; soldText: string; url: string }[]> {
  const searchUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=120`

  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS })

  const title = await page.title()
  if (/security|robot|challenge/i.test(title)) {
    throw new Error(`eBay challenge page returned for "${query}"`)
  }

  const result = await page.evaluate(() => {
    // Try both legacy (.s-item) and newer (.s-card / .srp-river-results-item) selectors.
    const selectors = [
      'li.s-item',
      'div.s-card',
      'li.srp-river-results-item',
    ]
    let chosen = ''
    let nodes: Element[] = []
    for (const sel of selectors) {
      const found = Array.from(document.querySelectorAll(sel))
      if (found.length > 0) {
        chosen = sel
        nodes = found
        break
      }
    }

    const results: { title: string; priceText: string; soldText: string; url: string }[] = []
    for (const item of nodes) {
      // Within each item, also try multiple title/price/sold selectors.
      const titleText =
        item.querySelector('.s-item__title')?.textContent?.trim() ??
        item.querySelector('[class*="title"]')?.textContent?.trim() ??
        ''
      const priceText =
        item.querySelector('.s-item__price')?.textContent?.trim() ??
        item.querySelector('[class*="price"]')?.textContent?.trim() ??
        ''
      const soldText =
        item.querySelector('.s-item__caption--signal')?.textContent?.trim() ??
        item.querySelector('.s-item__title--tagblock')?.textContent?.trim() ??
        item.querySelector('[class*="caption"]')?.textContent?.trim() ??
        ''
      const linkEl = item.querySelector('a[href*="/itm/"]') as HTMLAnchorElement | null
      if (!titleText || /shop on ebay/i.test(titleText)) continue
      results.push({ title: titleText, priceText, soldText, url: linkEl?.href ?? '' })
    }
    return { results, chosen, nodeCount: nodes.length }
  })

  if (debugDump && result.results.length === 0) {
    const html = await page.content()
    const fs = await import('node:fs')
    fs.writeFileSync('ebay-debug.html', html)
    console.log(
      `  [debug] No matches. Tried selectors, used "${result.chosen}", got ${result.nodeCount} nodes. HTML written to ebay-debug.html`,
    )
  } else if (result.results.length > 0) {
    console.log(`  [debug] Matched selector: ${result.chosen} (${result.nodeCount} nodes)`)
  }

  return result.results
}

function rowsFromRawResults(
  cardId: string,
  raw: { title: string; priceText: string; soldText: string; url: string }[],
  now: Date,
): ParsedSale[] {
  const out: ParsedSale[] = []
  for (const r of raw) {
    const gradeInfo = parseGradeFromTitle(r.title)
    if (!gradeInfo) continue
    const price = parsePrice(r.priceText)
    if (price == null || price <= 0) continue
    const soldAt = parseEbaySoldDate(r.soldText, now)
    if (!soldAt) continue
    const ebayItemId = parseEbayItemId(r.url)
    out.push({
      gradingCompany: gradeInfo.company,
      grade: gradeInfo.grade,
      price,
      soldAt,
      title: r.title,
      ebayItemId,
      listingUrl: r.url || null,
      parseConfidence: parseConfidence(r.title),
    })
    void cardId
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────
// Card selection
// ─────────────────────────────────────────────────────────────────────

interface CardTarget {
  cardId: string
  query: string
}

/**
 * Build an eBay search query from a TCGPlayer product name + card_id.
 * Goal: match the specific variant on eBay (e.g. "Red Super Alt Art").
 * Strategy: combine the base set code (e.g. "OP13-118") with the variant
 * keywords parsed from the product name. The set code anchors the search;
 * the keywords narrow it to the right variant.
 */
function buildQuery(cardId: string, productName: string | null): string {
  // "OP13-118_p3" → "OP13-118"
  const baseCode = cardId.replace(/_[^_]+$/, '')
  if (!productName) return baseCode

  // Pull descriptive bits from the TCGPlayer product name like
  // "Monkey.D.Luffy (118) (Red Super Alternate Art)" → "Red Super Alt"
  const variantMatch = productName.match(/\(([^()]+)\)\s*$/)
  if (!variantMatch) return baseCode
  const variant = variantMatch[1]
    .replace(/alternate art/i, 'alt art')
    .replace(/parallel/i, '')
    .trim()
  return `${baseCode} ${variant}`.trim()
}

async function selectTargets(opts: {
  cardId?: string
  threshold?: number
  all?: boolean
}): Promise<CardTarget[]> {
  // Prices/names live product-side now (card_prices was dropped, migration
  // 20260537): card_tcgplayer_mapping gives card_id → product_id + name, and
  // tcgplayer_current_prices gives the latest market_price per product.
  if (opts.cardId) {
    const { data } = await supabase
      .from('card_tcgplayer_mapping')
      .select('card_id, tcgplayer_name')
      .eq('card_id', opts.cardId)
      .single()
    return [
      {
        cardId: opts.cardId,
        query: buildQuery(opts.cardId, data?.tcgplayer_name ?? null),
      },
    ]
  }

  const [{ data: maps, error: mErr }, { data: prices, error: pErr }] = await Promise.all([
    supabase
      .from('card_tcgplayer_mapping')
      .select('card_id, tcgplayer_product_id, tcgplayer_name'),
    supabase
      .from('tcgplayer_current_prices')
      .select('tcgplayer_product_id, market_price')
      .not('market_price', 'is', null),
  ])
  if (mErr) throw mErr
  if (pErr) throw pErr

  const marketByProduct = new Map<number, number>()
  for (const p of prices ?? []) marketByProduct.set(p.tcgplayer_product_id as number, p.market_price as number)

  return (maps ?? [])
    .filter(m => m.card_id && m.tcgplayer_product_id != null && marketByProduct.has(m.tcgplayer_product_id as number))
    .map(m => ({
      cardId: m.card_id as string,
      name: m.tcgplayer_name as string | null,
      market: marketByProduct.get(m.tcgplayer_product_id as number)!,
    }))
    .filter(r => opts.all || opts.threshold == null || r.market >= opts.threshold)
    .sort((a, b) => b.market - a.market)
    .map(r => ({ cardId: r.cardId, query: buildQuery(r.cardId, r.name) }))
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────

interface CliOptions {
  cardId?: string
  threshold?: number
  all?: boolean
  dryRun?: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--all') out.all = true
    else if (a === '--dry-run') out.dryRun = true
    else if (a === '--threshold') out.threshold = Number(argv[++i])
    else if (!a.startsWith('--')) out.cardId = a
  }
  if (!out.cardId && out.threshold == null && !out.all) {
    // sensible default for "I just want to try this": $20+
    out.threshold = 20
  }
  return out
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  console.log('Options:', opts)

  const targets = await selectTargets(opts)
  if (targets.length === 0) {
    console.log('No matching cards found.')
    return
  }
  console.log(`Scraping ${targets.length} card(s)...`)

  const browser = (await puppeteerExtra.launch({
    headless: true,
  })) as unknown as Browser
  const page = await browser.newPage()
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  )
  await page.setViewport({ width: 1366, height: 768 })
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  })

  let totalParsed = 0
  let totalInserted = 0
  const now = new Date()

  for (const [i, t] of targets.entries()) {
    try {
      const raw = await scrapeCardSoldListings(page, t.query, !!opts.dryRun)
      const parsed = rowsFromRawResults(t.cardId, raw, now)
      totalParsed += parsed.length
      console.log(
        `[${i + 1}/${targets.length}] ${t.cardId} (query: "${t.query}"): ${raw.length} raw → ${parsed.length} graded`,
      )
      if (opts.dryRun && parsed.length > 0) {
        const sample = parsed.slice(0, 3)
        sample.forEach(p =>
          console.log(`    ${p.gradingCompany} ${p.grade}  $${p.price.toFixed(2)}  ${p.soldAt.toISOString().slice(0, 10)}  ${p.title.slice(0, 80)}`),
        )
      }

      if (!opts.dryRun && parsed.length > 0) {
        const rows = parsed.map(p => ({
          card_id: t.cardId,
          source: 'ebay',
          source_item_id: p.ebayItemId,
          grading_company: p.gradingCompany,
          grade: p.grade,
          sale_kind: 'sold',
          sold_at: p.soldAt.toISOString(),
          price: p.price,
          title: p.title,
          ebay_item_id: p.ebayItemId,
          listing_url: p.listingUrl,
          parse_confidence: p.parseConfidence,
        }))
        // Dedup on ebay_item_id (its partial unique index survived the rename to
        // slab_sales). ignoreDuplicates means an admin-set status='excluded' on a
        // previously-seen sale is never resurrected by a re-scrape.
        const { error } = await supabase
          .from('slab_sales')
          .upsert(rows, { onConflict: 'ebay_item_id', ignoreDuplicates: true })
        if (error) console.error(`  upsert error for ${t.cardId}:`, error.message)
        else totalInserted += rows.length
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[${i + 1}/${targets.length}] ${t.cardId}: ${msg}`)
    }

    if (i < targets.length - 1) {
      await new Promise(r => setTimeout(r, POLITE_DELAY_MS))
    }
  }

  await browser.close()

  console.log(`\nDone. Parsed: ${totalParsed}. Inserted (or upserted): ${totalInserted}.`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
