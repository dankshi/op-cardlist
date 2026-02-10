import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import type { CardPrice } from '@/types/card';

export async function GET() {
  const prices: Record<string, Partial<CardPrice>> = {};

  if (!supabase) {
    return NextResponse.json({ prices });
  }

  // Fetch all rows (paginated since Supabase defaults to 1000)
  const PAGE_SIZE = 1000;
  let from = 0;
  let done = false;

  while (!done) {
    const { data, error } = await supabase
      .from('card_prices')
      .select('*')
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error('Error fetching card_prices:', error);
      break;
    }

    for (const row of data || []) {
      prices[row.card_id] = {
        marketPrice: row.market_price ?? null,
        lowestPrice: row.lowest_price ?? null,
        medianPrice: row.median_price ?? null,
        totalListings: row.total_listings ?? null,
        lastSoldPrice: row.last_sold_price ?? null,
        lastSoldDate: row.last_sold_date ?? null,
        lastUpdated: row.updated_at ?? null,
        tcgplayerUrl: row.tcgplayer_url ?? null,
        tcgplayerProductId: row.tcgplayer_product_id ?? null,
      };
    }

    if (!data || data.length < PAGE_SIZE) {
      done = true;
    } else {
      from += PAGE_SIZE;
    }
  }

  return NextResponse.json({ prices });
}
