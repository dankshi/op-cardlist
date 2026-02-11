import { NextResponse } from 'next/server';
import { getSearchIndex, getSetIndex } from '@/lib/cards';

export async function GET() {
  const cards = await getSearchIndex();
  const sets = getSetIndex();
  return NextResponse.json(
    { cards, sets },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    }
  );
}
