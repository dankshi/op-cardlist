import { NextResponse } from 'next/server';

interface TCGSearchResult {
  productId: number;
  title: string;
  url: string;
  imageUrl: string;
  number: string;
  setName: string;
  rarity: string;
}

// GET /api/google-tcg-search - Search TCGPlayer directly using their internal API
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    return NextResponse.json({ error: 'Query required' }, { status: 400 });
  }

  try {
    // Use TCGPlayer's internal search API
    const response = await fetch(
      `https://mp-search-api.tcgplayer.com/v1/search/request?q=${encodeURIComponent(query)}&isList=false`,
      {
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          algorithm: 'sales_synonym_v2',
          from: 0,
          size: 24,
          filters: {
            term: {
              productLineName: ['one-piece-card-game'],
              productTypeName: ['Cards'],
            },
            range: {},
            match: {},
          },
          listingSearch: {
            context: { cart: {} },
            filters: {
              term: { sellerStatus: 'Live', channelId: 0 },
              range: { quantity: { gte: 1 } },
              exclude: { channelExclusion: 0 },
            },
          },
          context: {
            cart: {},
            shippingCountry: 'US',
          },
        }),
      }
    );

    if (!response.ok) {
      console.error('TCGPlayer API error:', response.status);
      return NextResponse.json({ results: [], error: `TCGPlayer API: HTTP ${response.status}` });
    }

    const data = await response.json();
    const results: TCGSearchResult[] = [];

    // Parse TCGPlayer search results
    const products = data.results?.[0]?.results || [];
    for (const product of products) {
      const productId = product.productId;
      if (!productId) continue;

      // Avoid duplicates
      if (!results.some(r => r.productId === productId)) {
        results.push({
          productId,
          title: product.productName || `Product #${productId}`,
          url: `https://www.tcgplayer.com/product/${productId}`,
          imageUrl: `https://product-images.tcgplayer.com/fit-in/400x558/${productId}.jpg`,
          number: product.customAttributes?.number || '',
          setName: product.setName || '',
          rarity: product.rarityName || '',
        });
      }
    }

    return NextResponse.json({
      results: results.slice(0, 20),
      query,
    });
  } catch (error) {
    console.error('TCGPlayer search error:', error);
    return NextResponse.json({
      error: 'Search failed',
      results: []
    });
  }
}
