import { NextResponse } from 'next/server';
import { getBrowsableCards, getCardById, getCardsByIds, getCardsByIdsBasic, searchCards } from '@/lib/cards';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const ids = searchParams.get('ids');
  const search = searchParams.get('search');
  const basic = searchParams.get('basic') === '1';

  // Batched lookup. Pages that need many cards at once (mystuff, orders)
  // hit this so they don't fan out N parallel single-card requests, which
  // used to trigger N full catalog scans + browser auth-lock contention.
  // `basic=1` skips the TCGplayer price join — use when callers only need
  // name/image for tiles. Cuts ~1.3s off the response for ~25 IDs.
  if (ids) {
    const idList = ids.split(',').map(s => s.trim()).filter(Boolean);
    if (idList.length === 0) return NextResponse.json({ cards: [] });
    const cards = basic ? await getCardsByIdsBasic(idList) : await getCardsByIds(idList);
    return NextResponse.json({ cards });
  }

  // Support single card lookup for client components (e.g., card modal)
  if (id) {
    const card = await getCardById(id);
    return NextResponse.json({ card: card ?? null });
  }

  // Support server-side search (filters out C/UC/R, tokenized matching)
  // mode=name restricts to name/ID only (no effect text matching)
  if (search) {
    const nameOnly = searchParams.get('mode') === 'name';
    const cards = await searchCards(search, nameOnly);
    return NextResponse.json({ cards });
  }

  // Bare "all cards" — serve only what the site shows (by-id lookups above stay
  // unfiltered, since collection/order callers may reference any owned card).
  const cards = await getBrowsableCards();
  return NextResponse.json({ cards });
}
