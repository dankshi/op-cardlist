import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import type { CardPrice } from '@/types/card';

// GET /api/prices — bulk export of every card's current price. Reads
// through the new product-keyed schema: card_tcgplayer_mapping gives us
// card_id → product_id, tcgplayer_current_prices (view) gives us today's
// market/lowest/median/total_listings for each product, and
// tcgplayer_products carries the last_sold_* eBay sales fields.
// Previously read tcgplayer_card_prices (denormalized, keyed by card_id);
// that table was dropped in migration 20260537.
export async function GET() {
  const prices: Record<string, Partial<CardPrice>> = {};

  if (!supabase) {
    return NextResponse.json({ prices });
  }

  async function paginate<T>(
    fetcher: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  ): Promise<T[]> {
    const all: T[] = [];
    for (let f = 0; ; f += 1000) {
      const { data, error } = await fetcher(f, f + 999);
      if (error) { console.error('api/prices fetch error:', error); break; }
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < 1000) break;
    }
    return all;
  }

  type MappingRow = { card_id: string; tcgplayer_product_id: number; tcgplayer_url: string | null; tcgplayer_name: string | null };
  type CurRow = { tcgplayer_product_id: number; recorded_date: string | null; market_price: number | null; lowest_price: number | null; median_price: number | null; total_listings: number | null };
  type ProdRow = { product_id: number; last_sold_price: number | null; last_sold_date: string | null };

  const [mappings, cur, prods] = await Promise.all([
    paginate<MappingRow>((from, to) =>
      supabase!.from('card_tcgplayer_mapping')
        .select('card_id, tcgplayer_product_id, tcgplayer_url, tcgplayer_name')
        .range(from, to),
    ),
    paginate<CurRow>((from, to) =>
      supabase!.from('tcgplayer_current_prices')
        .select('tcgplayer_product_id, recorded_date, market_price, lowest_price, median_price, total_listings')
        .range(from, to),
    ),
    paginate<ProdRow>((from, to) =>
      supabase!.from('tcgplayer_products')
        .select('product_id, last_sold_price, last_sold_date')
        .range(from, to),
    ),
  ]);

  const curByProduct = new Map(cur.map(c => [c.tcgplayer_product_id, c]));
  const prodByProduct = new Map(prods.map(p => [p.product_id, p]));

  for (const m of mappings) {
    if (m.tcgplayer_product_id == null) continue;
    const c = curByProduct.get(m.tcgplayer_product_id);
    const p = prodByProduct.get(m.tcgplayer_product_id);
    prices[m.card_id] = {
      marketPrice: c?.market_price ?? null,
      lowestPrice: c?.lowest_price ?? null,
      medianPrice: c?.median_price ?? null,
      totalListings: c?.total_listings ?? null,
      lastSoldPrice: p?.last_sold_price ?? null,
      lastSoldDate: p?.last_sold_date ?? null,
      lastUpdated: c?.recorded_date ?? null,
      tcgplayerUrl: m.tcgplayer_url ?? null,
      tcgplayerProductId: m.tcgplayer_product_id,
    };
  }

  return NextResponse.json({ prices });
}
