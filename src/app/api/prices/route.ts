import { NextResponse } from 'next/server';
import type { CardPrice } from '@/types/card';

export async function GET() {
  let prices: Record<string, Partial<CardPrice>> = {};

  try {
    const pricesData = await import('../../../../data/prices.json');
    prices = pricesData.prices || {};
  } catch {
    // No prices file yet
  }

  return NextResponse.json({ prices });
}
