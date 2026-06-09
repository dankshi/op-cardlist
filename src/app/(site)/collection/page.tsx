import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { getCardsByIds } from '@/lib/cards'
import { summarize, holdingMarketPrice, type Holding } from '@/lib/collection'
import { getPortfolioValueSeries, type Range } from '@/lib/collection-history'
import { CollectionClient } from '@/components/collection/CollectionClient'
import type { HoldingRow } from '@/components/collection/HoldingsGrid'
import type { CollectionItem } from '@/types/database'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Collection',
  description: 'Track the value of your One Piece TCG collection over time.',
}

const DEFAULT_RANGE: Range = '1M'

export default async function CollectionPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/sign-in?redirect=/collection')

  // gt('quantity', 0) hides lines fully sold off (a sale leaves the emptied
  // line in place so its dispositions keep a valid collection_id link).
  const { data: itemsRaw } = await supabase
    .from('collections')
    .select('*')
    .eq('user_id', user.id)
    .gt('quantity', 0)
    .order('created_at', { ascending: false })
  const items = (itemsRaw ?? []) as CollectionItem[]

  const holdings: Holding[] = items.map(i => ({
    cardId: i.card_id,
    condition: i.condition,
    quantity: i.quantity,
    acquiredPrice: i.acquired_price != null ? Number(i.acquired_price) : null,
  }))

  // Batch card metadata + current (raw) market price in one call.
  const uniqueIds = [...new Set(items.map(i => i.card_id))]
  const cards = uniqueIds.length ? await getCardsByIds(uniqueIds) : []
  const metaByCard = new Map(cards.map(c => [c.id, c]))

  // Graded slabs aren't priced by raw TCGplayer market. Value them by our
  // computed comp (slab_market_values + override); fall back to the lowest
  // active Nomi listing for that exact grade, then raw. See holdingMarketPrice.
  const gradedListingMin = new Map<string, number>()
  const slabValueMap = new Map<string, number>()
  const gradedCardIds = [...new Set(items.filter(i => i.grading_company && i.grade).map(i => i.card_id))]
  if (gradedCardIds.length) {
    const [{ data: listingRows }, { data: valueRows }, { data: overrideRows }] = await Promise.all([
      supabase
        .from('listings')
        .select('card_id, price, grading_company, grade')
        .eq('status', 'active')
        .in('card_id', gradedCardIds)
        .not('grading_company', 'is', null),
      supabase
        .from('slab_market_values')
        .select('card_id, grading_company, grade, market_value')
        .in('card_id', gradedCardIds),
      supabase
        .from('slab_value_overrides')
        .select('card_id, grading_company, grade, value')
        .in('card_id', gradedCardIds),
    ])
    for (const l of listingRows ?? []) {
      const key = `${l.card_id}|${l.grading_company}|${l.grade}`
      const price = Number(l.price)
      const cur = gradedListingMin.get(key)
      if (cur == null || price < cur) gradedListingMin.set(key, price)
    }
    for (const v of valueRows ?? []) {
      if (v.market_value != null) slabValueMap.set(`${v.card_id}|${v.grading_company}|${v.grade}`, Number(v.market_value))
    }
    // Override wins over the computed value.
    for (const o of overrideRows ?? []) {
      slabValueMap.set(`${o.card_id}|${o.grading_company}|${o.grade}`, Number(o.value))
    }
  }

  const rows: HoldingRow[] = items.map(i => {
    const meta = metaByCard.get(i.card_id)
    const rawMarket = meta?.price?.marketPrice ?? null
    const isGraded = !!(i.grading_company && i.grade)
    const acquiredPrice = i.acquired_price != null ? Number(i.acquired_price) : null
    const customValue = i.custom_value != null ? Number(i.custom_value) : null
    const variantKey = `${i.card_id}|${i.grading_company}|${i.grade}`
    const marketPrice = holdingMarketPrice({
      customValue,
      isGraded,
      slabValue: isGraded ? slabValueMap.get(variantKey) ?? null : null,
      gradedListing: isGraded ? gradedListingMin.get(variantKey) ?? null : null,
      rawMarket,
    })
    const qty = i.quantity
    const currentValue = marketPrice != null ? marketPrice * qty : null
    const costBasis = acquiredPrice != null ? acquiredPrice * qty : null
    const gain = currentValue != null && costBasis != null ? currentValue - costBasis : null
    const gainPct = gain != null && costBasis != null && costBasis > 0 ? gain / costBasis : null
    return {
      id: i.id,
      cardId: i.card_id,
      cardName: meta?.name ?? i.card_id,
      imageUrl: meta?.imageUrl ?? '',
      quantity: qty,
      acquiredPrice,
      acquiredDate: i.acquired_date,
      gradingCompany: i.grading_company,
      grade: i.grade,
      customValue,
      isCustomValue: customValue != null,
      serialNumber: i.serial_number,
      marketPrice,
      currentValue,
      costBasis,
      gain,
      gainPct,
    }
  })

  const summary = summarize(rows)
  const { series } = await getPortfolioValueSeries(holdings, DEFAULT_RANGE)

  // Realized P&L to date — sum of realized gain across recorded sales
  // (docs/collection-pnl.md). Null gains (sold without a known cost basis) are
  // excluded by the sum.
  const { data: saleRows } = await supabase
    .from('collection_sales')
    .select('realized_gain')
    .eq('user_id', user.id)
  const realizedGain = (saleRows ?? []).reduce((s, r) => s + (r.realized_gain != null ? Number(r.realized_gain) : 0), 0)

  return (
    <CollectionClient
      summary={{
        totalValue: summary.totalValue,
        totalGain: summary.totalGain,
        totalGainPct: summary.totalGainPct,
        cardCount: summary.cardCount,
        uniqueCount: rows.length,
        realizedGain,
      }}
      rows={rows}
      initialSeries={series}
      initialRange={DEFAULT_RANGE}
    />
  )
}
