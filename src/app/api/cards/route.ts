import { NextResponse } from 'next/server';
import { getAllCards, getCardById, searchCards } from '@/lib/cards';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const search = searchParams.get('search');

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

  const cards = await getAllCards();
  return NextResponse.json({ cards });
}
