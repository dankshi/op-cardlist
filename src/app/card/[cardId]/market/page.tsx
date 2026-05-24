import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { getCardById } from '@/lib/cards'
import { getCardSales, getCardGradedSales } from '@/lib/price-history'
import { createClient } from '@/lib/supabase/server'
import { CardThumbnail } from '@/components/card/CardThumbnail'
import { ConditionBadge } from '@/components/marketplace/ConditionBadge'
import { BuyNowButton } from '@/components/marketplace/BuyNowButton'
import { MarketTabs } from '@/components/card/MarketTabs'
import type { Listing, Bid, CardCondition } from '@/types/database'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ cardId: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { cardId } = await params
  const card = await getCardById(cardId.toUpperCase())
  if (!card) return { title: 'Card not found' }
  return {
    title: `${card.name} (${card.id}) — Market Data | Nomi`,
    description: `Full ask/bid/sales market data for ${card.name} (${card.id}).`,
    robots: { index: false }, // detail data, not a landing page
  }
}

/** Server row shape returned by the listings query below. We need seller's
 *  display name for the asks table — joined inline via the FK relationship. */
interface AskRow extends Pick<Listing, 'id' | 'price' | 'condition' | 'grading_company' | 'grade' | 'quantity_available' | 'created_at'> {
  seller?: { display_name: string | null; username: string | null } | null
}

interface BidRow extends Pick<Bid, 'id' | 'price' | 'grading_company' | 'grade' | 'created_at'> {
  buyer?: { display_name: string | null; username: string | null } | null
}

export default async function MarketDataPage({ params }: PageProps) {
  const { cardId } = await params
  const card = await getCardById(cardId.toUpperCase())
  if (!card) notFound()

  const supabase = await createClient()
  const [asksRes, bidsRes, sales, gradedSales] = await Promise.all([
    supabase
      .from('listings')
      .select('id, price, condition, grading_company, grade, quantity_available, created_at, seller:profiles!listings_seller_id_fkey(display_name, username)')
      .eq('card_id', card.id)
      .eq('status', 'active')
      .order('price', { ascending: true }),
    supabase
      .from('bids')
      .select('id, price, grading_company, grade, created_at, buyer:profiles!bids_user_id_fkey(display_name, username)')
      .eq('card_id', card.id)
      .eq('status', 'active')
      .order('price', { ascending: false }),
    getCardSales(card.id, 365),
    getCardGradedSales(card.id, 365),
  ])

  const asks = (asksRes.data ?? []) as unknown as AskRow[]
  const bids = (bidsRes.data ?? []) as unknown as BidRow[]

  // Combined sales feed, newest first, for the Sales tab.
  const allSales = [
    ...sales.map(s => ({
      date: s.date,
      price: Number(s.price),
      label: variantLabelFromSale(s.condition, s.variant),
      source: s.listing_type ?? 'sale',
    })),
    ...gradedSales.map(g => ({
      date: g.date,
      price: Number(g.price),
      label: `${g.grading_company} ${g.grade}`,
      source: 'graded',
    })),
  ].sort((a, b) => b.date.localeCompare(a.date))

  const lowestAsk = asks[0] ? Number(asks[0].price) : null
  const highestBid = bids[0] ? Number(bids[0].price) : null
  const last3Months = allSales.filter(s => Date.now() - new Date(s.date).getTime() < 90 * 86400_000)
  const last12Months = allSales.filter(s => Date.now() - new Date(s.date).getTime() < 365 * 86400_000)
  const priceRange12 = rangeOf(last12Months.map(s => s.price))
  const priceRange3 = rangeOf(last3Months.map(s => s.price))
  const avgSale3 = last3Months.length > 0
    ? last3Months.reduce((a, s) => a + s.price, 0) / last3Months.length
    : null
  const lastSale = allSales[0]
  const lastSaleDelta = lastSale && card.price?.marketPrice != null
    ? ((lastSale.price - card.price.marketPrice) / card.price.marketPrice) * 100
    : null

  return (
    <div>
      {/* Breadcrumbs */}
      <nav className="text-sm text-zinc-500 mb-6">
        <Link href={`/card/${card.id.toLowerCase()}`} className="hover:text-zinc-900 transition-colors">
          ← {card.name}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-zinc-900">Market Data</span>
      </nav>

      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8 mb-8">
        {/* Left: small card image + buy CTA */}
        <div className="md:sticky md:top-24 md:self-start space-y-4">
          <div className="w-full max-w-[260px] mx-auto md:mx-0">
            <CardThumbnail card={card} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-zinc-900">{card.name}</h1>
            <p className="text-xs text-zinc-500 font-mono mt-0.5">{card.id}</p>
          </div>
          {lowestAsk != null && asks[0] && (
            <div className="rounded-xl border-2 border-zinc-200 bg-white p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Lowest ask</p>
              <p className="text-3xl font-bold tabular-nums text-zinc-900 mt-1 mb-3">${lowestAsk.toFixed(2)}</p>
              <BuyNowButton listingId={asks[0].id} price={lowestAsk} size="lg" />
            </div>
          )}
        </div>

        {/* Right: stats panel + tabbed market data */}
        <div className="space-y-6">
          <StatsPanel
            lowestAsk={lowestAsk}
            highestBid={highestBid}
            lastSale={lastSale?.price ?? null}
            lastSaleDelta={lastSaleDelta}
            marketPrice={card.price?.marketPrice ?? null}
            priceRange12={priceRange12}
            priceRange3={priceRange3}
            avgSale3={avgSale3}
            salesCount3={last3Months.length}
            salesCount12={last12Months.length}
          />

          <MarketTabs
            asks={asks.map(a => ({
              id: a.id,
              price: Number(a.price),
              condition: a.condition,
              grading_company: a.grading_company,
              grade: a.grade,
              quantity_available: a.quantity_available,
              created_at: a.created_at,
              sellerName: a.seller?.display_name || a.seller?.username || 'Seller',
            }))}
            bids={bids.map(b => ({
              id: b.id,
              price: Number(b.price),
              grading_company: b.grading_company,
              grade: b.grade,
              created_at: b.created_at,
              buyerName: b.buyer?.display_name || b.buyer?.username || 'Buyer',
            }))}
            sales={allSales.slice(0, 100)}
            cardId={card.id}
          />
        </div>
      </div>
    </div>
  )
}

function variantLabelFromSale(condition: string | null, variant: string | null): string {
  if (variant && /psa|bgs|cgc|tag/i.test(variant)) return variant
  return condition ?? 'NM'
}

function rangeOf(values: number[]): { min: number; max: number } | null {
  if (values.length === 0) return null
  let min = values[0]
  let max = values[0]
  for (const v of values) {
    if (v < min) min = v
    if (v > max) max = v
  }
  return { min, max }
}

function StatsPanel({
  lowestAsk,
  highestBid,
  lastSale,
  lastSaleDelta,
  marketPrice,
  priceRange12,
  priceRange3,
  avgSale3,
  salesCount3,
  salesCount12,
}: {
  lowestAsk: number | null
  highestBid: number | null
  lastSale: number | null
  lastSaleDelta: number | null
  marketPrice: number | null
  priceRange12: { min: number; max: number } | null
  priceRange3: { min: number; max: number } | null
  avgSale3: number | null
  salesCount3: number
  salesCount12: number
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Stat label="Lowest Ask" value={lowestAsk != null ? `$${lowestAsk.toFixed(2)}` : '—'} />
      <Stat label="Highest Bid" value={highestBid != null ? `$${highestBid.toFixed(2)}` : '—'} />
      <Stat
        label="Last Sale"
        value={lastSale != null ? `$${lastSale.toFixed(2)}` : '—'}
        sub={lastSaleDelta != null ? `${lastSaleDelta >= 0 ? '+' : ''}${lastSaleDelta.toFixed(1)}% vs market` : undefined}
        subClass={lastSaleDelta != null && lastSaleDelta < 0 ? 'text-rose-500' : 'text-emerald-600'}
      />
      <Stat label="Market" value={marketPrice != null ? `$${marketPrice.toFixed(2)}` : '—'} sub="TCGplayer" />
      <Stat
        label="Range — 3M"
        value={priceRange3 ? `$${priceRange3.min.toFixed(2)}–$${priceRange3.max.toFixed(2)}` : '—'}
      />
      <Stat
        label="Range — 12M"
        value={priceRange12 ? `$${priceRange12.min.toFixed(2)}–$${priceRange12.max.toFixed(2)}` : '—'}
      />
      <Stat label="Avg Sale — 3M" value={avgSale3 != null ? `$${avgSale3.toFixed(2)}` : '—'} />
      <Stat
        label="Sales — 3M"
        value={salesCount3.toString()}
        sub={`${salesCount12} in last 12M`}
      />
    </div>
  )
}

function Stat({ label, value, sub, subClass }: { label: string; value: string; sub?: string; subClass?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="text-lg font-bold tabular-nums text-zinc-900 mt-1">{value}</p>
      {sub && <p className={`text-[11px] mt-0.5 ${subClass ?? 'text-zinc-500'}`}>{sub}</p>}
    </div>
  )
}

// Re-export types so MarketTabs and any other consumers stay in sync.
export type AskTableRow = {
  id: string
  price: number
  condition: CardCondition
  grading_company: string | null
  grade: string | null
  quantity_available: number
  created_at: string
  sellerName: string
}
export type BidTableRow = {
  id: string
  price: number
  grading_company: string | null
  grade: string | null
  created_at: string
  buyerName: string
}
export type SaleTableRow = {
  date: string
  price: number
  label: string
  source: string
}
