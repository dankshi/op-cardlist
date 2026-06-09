import { NextResponse } from 'next/server'
import { getCardPopulations } from '@/lib/price-history'

/** Public population data (graded pops) for a card — powers the population
 *  detail shown in the collection edit modal. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ cardId: string }> },
) {
  const { cardId } = await params
  const populations = await getCardPopulations(cardId.toUpperCase())
  return NextResponse.json({ populations })
}
