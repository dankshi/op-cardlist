import { NextResponse } from 'next/server';
import { getAllCards, getCardById } from '@/lib/cards';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  // Support single card lookup for client components (e.g., card modal)
  if (id) {
    const card = await getCardById(id);
    return NextResponse.json({ card: card ?? null });
  }

  const cards = await getAllCards();
  return NextResponse.json({ cards });
}
