import { NextResponse } from 'next/server';
import { getSearchIndex } from '@/lib/cards';

export async function GET() {
  const index = await getSearchIndex();
  return NextResponse.json(
    { cards: index },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    }
  );
}
