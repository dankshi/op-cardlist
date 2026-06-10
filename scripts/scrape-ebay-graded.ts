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
import { expectedVariant, variantMatch, type ExpectedVariant } from '../src/lib/slab-listing-match'
import * as cheerio from 'cheerio'

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
// Fetching + parsing
// ─────────────────────────────────────────────────────────────────────

interface RawListing {
  title: string
  priceText: string
  soldText: string
  url: string
}

/** eBay sold/completed search, most-recently-ended first, 120 per page. */
function buildSearchUrl(query: string): string {
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=120`
}

/** Cheap detection of an eBay bot-challenge / interstitial page. */
function isChallengeHtml(html: string): boolean {
  const head = html.slice(0, 6000).toLowerCase()
  return /<title>[^<]*(security measure|robot|challenge|pardon our interruption|checking your browser)/.test(head)
    || /please verify yourself|px-captcha|hcaptcha|recaptcha/.test(head)
}

/**
 * Extract sold-listing rows from eBay search HTML. Source-independent: the same
 * parser runs whether the HTML came from local puppeteer or a scraping vendor,
 * so the fragile fetch and the stable parse evolve separately. Tries legacy
 * (.s-item) and newer (.s-card / .srp-river-results-item) result selectors.
 */
function parseSoldSearchHtml(html: string): { results: RawListing[]; chosen: string; nodeCount: number } {
  const $ = cheerio.load(html)
  const results: RawListing[] = []
  for (const sel of ['li.s-item', 'div.s-card', 'li.srp-river-results-item']) {
    const found = $(sel)
    if (found.length === 0) continue
    found.each((_, el) => {
      const item = $(el)
      const pick = (sels: string[]): string => {
        for (const s of sels) {
          const t = item.find(s).first().text().trim()
          if (t) return t
        }
        return ''
      }
      const title = pick(['.s-item__title', '[class*="title"]'])
      const priceText = pick(['.s-item__price', '[class*="price"]'])
      const soldText = pick(['.s-item__caption--signal', '.s-item__title--tagblock', '[class*="caption"]'])
      const url = item.find('a[href*="/itm/"]').first().attr('href') ?? ''
      if (!title || /shop on ebay/i.test(title)) return
      results.push({ title, priceText, soldText, url })
    })
    return { results, chosen: sel, nodeCount: found.length }
  }
  return { results, chosen: '', nodeCount: 0 }
}

// ─────────────────────────────────────────────────────────────────────
// Fetchers — the one swappable seam. Local puppeteer by default; set
// EBAY_FETCH_ENDPOINT to route through a scraping vendor (ScraperAPI / Zyte /
// Bright-Data-style "GET this url → return HTML" endpoint) so the anti-bot layer
// can change without touching the parse/ingest code. Vendors run on residential
// IPs; local puppeteer needs one too (datacenter IPs get challenged).
// ─────────────────────────────────────────────────────────────────────

interface SearchFetcher {
  readonly label: string
  fetchHtml(query: string): Promise<string>
}

class PuppeteerFetcher implements SearchFetcher {
  readonly label = 'local puppeteer'
  constructor(private page: Page) {}
  async fetchHtml(query: string): Promise<string> {
    await this.page.goto(buildSearchUrl(query), { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS })
    return this.page.content()
  }
}

class HttpEndpointFetcher implements SearchFetcher {
  readonly label = 'vendor endpoint'
  constructor(private template: string) {}
  async fetchHtml(query: string): Promise<string> {
    const target = buildSearchUrl(query)
    // Template may contain {url} (substituted, encoded) or be a prefix to append the encoded target to.
    const endpoint = this.template.includes('{url}')
      ? this.template.replace('{url}', encodeURIComponent(target))
      : this.template + encodeURIComponent(target)
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) })
    if (!res.ok) throw new Error(`fetch endpoint returned HTTP ${res.status}`)
    return res.text()
  }
}

async function scrapeCardSoldListings(
  fetcher: SearchFetcher,
  query: string,
  debugDump = false,
): Promise<RawListing[]> {
  const html = await fetcher.fetchHtml(query)
  if (isChallengeHtml(html)) {
    throw new Error(`eBay challenge page returned for "${query}"`)
  }
  const { results, chosen, nodeCount } = parseSoldSearchHtml(html)
  if (debugDump && results.length === 0) {
    const fs = await import('node:fs')
    fs.writeFileSync('ebay-debug.html', html)
    console.log(`  [debug] No matches. Used "${chosen}", got ${nodeCount} nodes. HTML written to ebay-debug.html`)
  } else if (results.length > 0) {
    console.log(`  [debug] Matched selector: ${chosen} (${nodeCount} nodes)`)
  }
  return results
}

function rowsFromRawResults(
  raw: RawListing[],
  now: Date,
  expected: ExpectedVariant,
): { rows: ParsedSale[]; droppedVariant: number } {
  const out: ParsedSale[] = []
  let droppedVariant = 0
  for (const r of raw) {
    const gradeInfo = parseGradeFromTitle(r.title)
    if (!gradeInfo) continue
    // Wrong variant leaked into the search (e.g. an alt-art listing returned for
    // a base-card query) — drop it so it can't pollute this variant's comp.
    const vm = variantMatch(expected, r.title)
    if (vm === 'mismatch') { droppedVariant++; continue }
    const price = parsePrice(r.priceText)
    if (price == null || price <= 0) continue
    const soldAt = parseEbaySoldDate(r.soldText, now)
    if (!soldAt) continue
    const ebayItemId = parseEbayItemId(r.url)
    // Low confidence when the title smells like a lot/bundle OR the variant is
    // ambiguous (special target, but the title gives no special signal).
    const confidence = parseConfidence(r.title) === 'low' || vm === 'uncertain' ? 'low' : 'high'
    out.push({
      gradingCompany: gradeInfo.company,
      grade: gradeInfo.grade,
      price,
      soldAt,
      title: r.title,
      ebayItemId,
      listingUrl: r.url || null,
      parseConfidence: confidence,
    })
  }
  return { rows: out, droppedVariant }
}

// ─────────────────────────────────────────────────────────────────────
// Card selection
// ─────────────────────────────────────────────────────────────────────

interface CardTarget {
  cardId: string
  query: string
  /** TCGplayer product name — used (with the card_id parallel suffix) to decide
   *  the expected variant so we can drop listings of the wrong variant. */
  tcgName: string | null
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
        tcgName: data?.tcgplayer_name ?? null,
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
    .map(r => ({ cardId: r.cardId, query: buildQuery(r.cardId, r.name), tcgName: r.name }))
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

  // Fetch seam: route through a scraping vendor when EBAY_FETCH_ENDPOINT is set
  // (runs on the vendor's residential IPs), else local puppeteer.
  const endpoint = process.env.EBAY_FETCH_ENDPOINT
  let browser: Browser | null = null
  let fetcher: SearchFetcher
  if (endpoint) {
    fetcher = new HttpEndpointFetcher(endpoint)
    console.log('Fetcher: vendor endpoint (EBAY_FETCH_ENDPOINT).')
  } else {
    browser = (await puppeteerExtra.launch({ headless: true })) as unknown as Browser
    const page = await browser.newPage()
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    )
    await page.setViewport({ width: 1366, height: 768 })
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    })
    fetcher = new PuppeteerFetcher(page)
    console.log('Fetcher: local puppeteer (needs a residential IP — datacenter IPs get challenged).')
  }

  let totalParsed = 0
  let totalInserted = 0
  const now = new Date()

  for (const [i, t] of targets.entries()) {
    try {
      const raw = await scrapeCardSoldListings(fetcher, t.query, !!opts.dryRun)
      const expected = expectedVariant(t.cardId, t.tcgName)
      const { rows: parsed, droppedVariant } = rowsFromRawResults(raw, now, expected)
      totalParsed += parsed.length
      console.log(
        `[${i + 1}/${targets.length}] ${t.cardId} (query: "${t.query}", ${expected}): ` +
          `${raw.length} raw → ${parsed.length} graded` +
          `${droppedVariant > 0 ? ` (${droppedVariant} wrong-variant dropped)` : ''}`,
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

  if (browser) await browser.close()

  console.log(`\nDone. Parsed: ${totalParsed}. Inserted (or upserted): ${totalInserted}.`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
