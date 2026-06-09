/** Shared TCGplayer sales-feed helpers used by BOTH the cron scraper
 *  (scripts/scrape-prices.ts) and the admin on-demand "scrape this card"
 *  route — so a manual scrape parses and stores sales identically to the
 *  scheduled one. */

const ENDPOINT = (productId: number) =>
  `https://mpapi.tcgplayer.com/v2/product/${productId}/latestsales`
const PAGE_SIZE = 25
const MAX_PAGES = 6
const CUTOFF_DAYS = 90

export interface SaleRecord {
  price: number
  date: string
  condition: string | null
  variant: string | null
  language: string | null
  listingType: string | null
  shippingPrice: number | null
  customListingId: string | null
  quantity: number
}

/** Map a raw latestsales row to our SaleRecord shape. Single source of truth
 *  for the field mapping. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseSale(s: any): SaleRecord {
  return {
    price: s.purchasePrice,
    date: s.orderDate,
    condition: s.condition ?? null,
    variant: s.variant ?? null,
    language: s.language ?? null,
    listingType: s.listingType ?? null,
    shippingPrice: s.shippingPrice ?? null,
    customListingId: s.customListingId ?? null,
    quantity: s.quantity ?? 1,
  }
}

/** Fetch up to ~90 days of sales for one product (newest first). Single-shot
 *  pagination — no rotation/retry, intended for an interactive admin scrape of
 *  a single card. Returns [] on any failure. */
export async function fetchProductSales(
  productId: number,
  cookie?: string,
): Promise<SaleRecord[]> {
  const all: SaleRecord[] = []
  const snapshotTime = Date.now()
  const cutoff = Date.now() - CUTOFF_DAYS * 24 * 60 * 60 * 1000
  for (let page = 0; page < MAX_PAGES; page++) {
    let data: { data?: unknown[]; nextPage?: string }
    try {
      const res = await fetch(ENDPOINT(productId), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Origin: 'https://www.tcgplayer.com',
          Referer: 'https://www.tcgplayer.com/',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
          ...(cookie ? { Cookie: `TCGAuthTicket_Production=${cookie}` } : {}),
        },
        body: JSON.stringify({
          conditions: [],
          languages: [],
          variants: [],
          listingType: 'All',
          offset: page * PAGE_SIZE,
          limit: PAGE_SIZE,
          time: snapshotTime,
        }),
      })
      if (!res.ok) break
      const text = await res.text()
      if (text.startsWith('<')) break // HTML = rate-limited/blocked
      data = JSON.parse(text)
    } catch {
      break
    }
    const rows = Array.isArray(data.data) ? data.data : []
    if (rows.length === 0) break
    const parsed = rows.map(parseSale)
    all.push(...parsed)
    const oldest = parsed[parsed.length - 1]
    if (data.nextPage !== 'Yes') break
    if (oldest && new Date(oldest.date).getTime() < cutoff) break
    await new Promise(r => setTimeout(r, 400))
  }
  return all.filter(s => new Date(s.date).getTime() >= cutoff)
}
