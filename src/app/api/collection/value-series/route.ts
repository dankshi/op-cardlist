import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getPortfolioValueSeries, type Range } from '@/lib/collection-history'
import type { Holding } from '@/lib/collection'

const RANGES: Range[] = ['1W', '1M', '3M', '1Y', 'All']

/** Recompute the portfolio value series for a time range — backs the chart's
 *  range tabs without a full page reload. */
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rangeParam = new URL(request.url).searchParams.get('range') as Range | null
  const range: Range = rangeParam && RANGES.includes(rangeParam) ? rangeParam : '1M'

  const { data: rows } = await supabase
    .from('collections')
    .select('card_id, condition, quantity, acquired_price')
    .eq('user_id', user.id)
  const holdings: Holding[] = (rows ?? []).map(r => ({
    cardId: r.card_id as string,
    condition: r.condition,
    quantity: r.quantity as number,
    acquiredPrice: r.acquired_price != null ? Number(r.acquired_price) : null,
  }))

  const { series, latestValue } = await getPortfolioValueSeries(holdings, range)
  return NextResponse.json({ range, series, latestValue })
}
