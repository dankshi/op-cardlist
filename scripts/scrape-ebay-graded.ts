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
  imageUrl: string | null
  listingFormat: string | null
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

  // BGS Black Label tracked as its own grade ("Black Label 10"), matching the
  // grade-ladder chip — not folded into BGS 10.
  if (/\bBGS\b.*\bBLACK\s*LABEL\b|\bBLACK\s*LABEL\b.*\bBGS\b/.test(upper)) {
    return { company: 'BGS', grade: 'Black Label 10' }
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
  imageUrl: string
  format: string | null // auction | buy_it_now | best_offer | null
}

/** eBay search URL. sold=true → sold/completed, most-recently-ended first.
 *  sold=false → currently-active listings (used to detect still-live items that
 *  eBay's sold search wrongly includes — GTC/relisted). 120 per page. */
function buildSearchUrl(query: string, sold = true): string {
  const params = sold ? '&LH_Sold=1&LH_Complete=1&_sop=13' : ''
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}${params}&_ipg=120`
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
 * so the fragile fetch and the stable parse evolve separately.
 *
 * eBay's current search markup is the `.s-card` family (`.s-card__title` /
 * `.s-card__price` / `.s-card__caption`); the legacy `.s-item` / `srp-river`
 * selectors are kept as fallbacks in case an older layout is ever served. The
 * "Shop on eBay" placeholder cards are filtered by title.
 */
function parseSoldSearchHtml(html: string): { results: RawListing[]; chosen: string; nodeCount: number } {
  const $ = cheerio.load(html)
  const results: RawListing[] = []
  for (const sel of ['.s-card', 'li.s-item', 'li.srp-river-results-item']) {
    const found = $(sel)
    if (found.length === 0) continue
    found.each((_, el) => {
      const item = $(el)
      // eBay hides screen-reader text ("Opens in a new window or tab") in .clipped
      // spans that get concatenated onto the title and mangle the grade parse
      // (e.g. "BGS 9.5Opens…" → parsed as "9"). Drop them before reading text.
      item.find('.clipped').remove()
      const pick = (sels: string[]): string => {
        for (const s of sels) {
          const t = item.find(s).first().text().trim()
          if (t) return t
        }
        return ''
      }
      const title = pick(['.s-card__title', '.s-item__title', '[class*="title"]'])
      if (!title || /shop on ebay/i.test(title)) return
      const priceText = pick(['.s-card__price', '.s-item__price', '[class*="price"]'])
      const soldText = pick(['.s-card__caption', '.s-item__caption--signal', '.s-item__title--tagblock', '[class*="caption"]'])
      const url = item.find('a[href*="/itm/"]').first().attr('href') ?? ''
      // Listing image (prefer an i.ebayimg.com URL) for admin verification.
      let imageUrl = ''
      item.find('img').each((_, im) => {
        if (imageUrl) return
        const src = $(im).attr('src') || $(im).attr('data-src') || ''
        if (/ebayimg\.com/i.test(src)) imageUrl = src
      })
      if (!imageUrl) imageUrl = item.find('img').first().attr('src') ?? ''
      // Listing format. Crucially distinguish a real accepted-offer sale ("Best
      // offer accepted" — eBay strikes through the original ask and HIDES the
      // actual lower price, so it's unreliable) from a listing that merely
      // *offered* Best Offer but sold at the shown price ("or Best Offer" —
      // reliable). The offer text lives in the price block, not the attribute
      // rows, so read the whole card.
      // No \b boundaries: eBay concatenates the price block ("$1,300.00or Best
      // Offer"), so a boundary before "or" wouldn't match.
      const cardText = item.text().toLowerCase()
      const format = /best offer accepted/.test(cardText) ? 'best_offer'
        : /or best offer/.test(cardText) ? 'buy_it_now'
        : /buy it now/.test(cardText) ? 'buy_it_now'
        : /\d+\s*bids?/.test(cardText) ? 'auction'
        : null
      results.push({ title, priceText, soldText, url, imageUrl, format })
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
  fetchHtml(query: string, sold?: boolean): Promise<string>
}

class PuppeteerFetcher implements SearchFetcher {
  readonly label = 'local puppeteer'
  constructor(private page: Page) {}
  async fetchHtml(query: string, sold = true): Promise<string> {
    await this.page.goto(buildSearchUrl(query, sold), { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS })
    return this.page.content()
  }
}

class HttpEndpointFetcher implements SearchFetcher {
  readonly label = 'vendor endpoint'
  constructor(private template: string) {}
  async fetchHtml(query: string, sold = true): Promise<string> {
    const target = buildSearchUrl(query, sold)
    // Template may contain {url} (substituted, encoded) or be a prefix to append the encoded target to.
    const endpoint = this.template.includes('{url}')
      ? this.template.replace('{url}', encodeURIComponent(target))
      : this.template + encodeURIComponent(target)
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) })
    if (!res.ok) throw new Error(`fetch endpoint returned HTTP ${res.status}`)
    return res.text()
  }
}

/**
 * Bright Data Web Unlocker (direct API). POSTs the target URL and gets the raw
 * unblocked HTML back — Bright Data handles residential proxies, CAPTCHA, and
 * retries server-side, so this runs fine from any host (incl. datacenter IPs).
 * It can be slow (internal retries), hence the longer timeout.
 * Docs: https://docs.brightdata.com/scraping-automation/web-unlocker
 */
class BrightDataFetcher implements SearchFetcher {
  readonly label = 'Bright Data Web Unlocker'
  constructor(private apiToken: string, private zone: string) {}
  async fetchHtml(query: string, sold = true): Promise<string> {
    const res = await fetch('https://api.brightdata.com/request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiToken}`,
      },
      body: JSON.stringify({ zone: this.zone, url: buildSearchUrl(query, sold), format: 'raw' }),
      signal: AbortSignal.timeout(90_000),
    })
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200)
      throw new Error(`Bright Data returned HTTP ${res.status}${detail ? `: ${detail}` : ''}`)
    }
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
    // An accepted-offer sale (format 'best_offer') shows the struck-through ask,
    // not the real (hidden, lower) sale price — so its price is unreliable → low.
    // A plain "or Best Offer" listing that sold at list price is reliable.
    const confidence =
      parseConfidence(r.title) === 'low' || vm === 'uncertain' || r.format === 'best_offer' ? 'low' : 'high'
    out.push({
      gradingCompany: gradeInfo.company,
      grade: gradeInfo.grade,
      price,
      soldAt,
      title: r.title,
      ebayItemId,
      listingUrl: r.url || null,
      imageUrl: r.imageUrl || null,
      listingFormat: r.format,
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

  // Human-style search: "<number> <character> <rarity spelled out>", e.g.
  // "OP07-109 Luffy treasure rare". Two fixes vs the old "<number> TR":
  //   1. Spell out the rarity — sellers write "Treasure Rare", rarely the "TR"
  //      abbreviation, so requiring "TR" silently dropped real sales.
  //   2. Keep the rarity word as the precision filter — eBay tokenizes
  //      "OP07-109" into OP07 + 109, so number-only matches any OP07 Luffy lot
  //      mentioning "109"; the rarity word pins it to the right card.
  const lead = productName.replace(/\s*\(.*$/, '').trim()
  const name = lead.split(/[.\s]+/).filter(Boolean).pop() ?? '' // "Monkey.D.Luffy" → "Luffy"
  const tail = productName.match(/\(([^()]+)\)\s*$/)
  const rarity = (tail?.[1] ?? '')
    .toLowerCase()
    .replace(/^tr$/, 'treasure rare')
    .replace(/^sec$/, 'secret rare')
    .replace(/^sr$/, 'super rare')
    .replace(/alternate art/, 'alt art')
    .replace(/parallel/, '')
    .trim()
  return [baseCode, name, rarity].filter(Boolean).join(' ')
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
  limit?: number
  refresh?: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--all') out.all = true
    else if (a === '--dry-run') out.dryRun = true
    else if (a === '--refresh') out.refresh = true
    else if (a === '--threshold') out.threshold = Number(argv[++i])
    else if (a === '--limit') out.limit = Number(argv[++i])
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

  const allTargets = await selectTargets(opts)
  // --limit caps the run to the top-N highest-value targets (they're sorted by
  // market price desc) — keeps trial runs small + cheap on a paid vendor.
  const targets = opts.limit ? allTargets.slice(0, opts.limit) : allTargets
  if (targets.length === 0) {
    console.log('No matching cards found.')
    return
  }
  console.log(`Scraping ${targets.length} card(s)...`)

  // Fetch seam, in priority order: Bright Data Web Unlocker (BRIGHTDATA_API_TOKEN
  // + BRIGHTDATA_ZONE) → generic vendor endpoint (EBAY_FETCH_ENDPOINT) → local
  // puppeteer. The first two run on vendor residential IPs; puppeteer needs one.
  const bdToken = process.env.BRIGHTDATA_API_TOKEN
  const bdZone = process.env.BRIGHTDATA_ZONE
  const endpoint = process.env.EBAY_FETCH_ENDPOINT
  let browser: Browser | null = null
  let fetcher: SearchFetcher
  if (bdToken && bdZone) {
    fetcher = new BrightDataFetcher(bdToken, bdZone)
    console.log(`Fetcher: Bright Data Web Unlocker (zone "${bdZone}").`)
  } else if (endpoint) {
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
  let succeeded = 0
  let challenged = 0
  let errored = 0
  const now = new Date()

  for (const [i, t] of targets.entries()) {
    try {
      // --refresh: clear this card's eBay rows first so a re-scrape re-classifies
      // them (new grades/formats/active-status) instead of being skipped by dedup.
      if (opts.refresh && !opts.dryRun) {
        await supabase.from('slab_sales').delete().eq('card_id', t.cardId).eq('source', 'ebay')
      }
      const raw = await scrapeCardSoldListings(fetcher, t.query, !!opts.dryRun)
      succeeded++
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
        // Dedup in-app rather than via ON CONFLICT: our unique indexes are
        // partial (WHERE ...), which Postgres can't infer for an upsert target.
        // Skip eBay items we already have (ebay_item_id is globally unique, so
        // check across all cards) — this preserves any admin-set status on them
        // (an excluded sale won't be re-inserted) — then plain-insert the rest.
        const itemIds = parsed.map(p => p.ebayItemId).filter((x): x is string => !!x)
        const existing = new Set<string>()
        if (itemIds.length) {
          const { data: have } = await supabase
            .from('slab_sales')
            .select('ebay_item_id')
            .in('ebay_item_id', itemIds)
          for (const r of have ?? []) if (r.ebay_item_id) existing.add(r.ebay_item_id as string)
        }
        const seen = new Set<string>()
        const fresh = parsed.filter(p => {
          if (!p.ebayItemId) return true // no id → rely on the natural-key index
          if (existing.has(p.ebayItemId) || seen.has(p.ebayItemId)) return false
          seen.add(p.ebayItemId)
          return true
        })
        if (fresh.length > 0) {
          const rows = fresh.map(p => ({
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
            image_url: p.imageUrl,
            listing_format: p.listingFormat,
            parse_confidence: p.parseConfidence,
          }))
          const { error } = await supabase.from('slab_sales').insert(rows)
          if (error) console.error(`  insert error for ${t.cardId}:`, error.message)
          else totalInserted += rows.length
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/challenge/i.test(msg)) challenged++
      else errored++
      console.error(`[${i + 1}/${targets.length}] ${t.cardId}: ${msg}`)
    }

    if (i < targets.length - 1) {
      await new Promise(r => setTimeout(r, POLITE_DELAY_MS))
    }
  }

  if (browser) await browser.close()

  console.log(
    `\nDone. Fetch: ${succeeded}/${targets.length} OK` +
      `${challenged ? `, ${challenged} challenged` : ''}${errored ? `, ${errored} errored` : ''}. ` +
      `Parsed: ${totalParsed} graded sales. Inserted (or upserted): ${totalInserted}.`,
  )
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
