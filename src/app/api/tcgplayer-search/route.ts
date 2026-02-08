import { NextResponse } from 'next/server';

const TCGPLAYER_SEARCH_URL = 'https://mp-search-api.tcgplayer.com/v1/search/request';

interface TCGPlayerProduct {
  productId: number;
  productName: string;
  marketPrice: number | null;
  lowPrice: number | null;
  productUrlName: string;
  customAttributes: {
    number?: string;
  };
}

async function searchTCGPlayer(query: string): Promise<TCGPlayerProduct[]> {
  const searchPayload = {
    algorithm: 'sales_exp_fields_boosted',
    from: 0,
    size: 50,
    filters: {
      term: {
        productLineName: ['one-piece-card-game'],
        productTypeName: ['Cards'],
      },
      range: {},
      match: {},
    },
    listingSearch: {
      filters: {
        term: {},
        range: {},
        exclude: { channelExclusion: 0 },
      },
    },
    context: { cart: {}, shippingCountry: 'US' },
    settings: { useFuzzySearch: true, didYouMean: {} },
    sort: {},
  };

  const url = `${TCGPLAYER_SEARCH_URL}?q=${encodeURIComponent(query)}&isList=false`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    body: JSON.stringify(searchPayload),
  });

  if (!response.ok) {
    return [];
  }

  const data = await response.json();
  return (data as any).results?.[0]?.results || [];
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const cardName = searchParams.get('name') || '';
  const cardNumber = searchParams.get('number') || '';
  const baseId = searchParams.get('baseId') || ''; // e.g., "EB01-006"

  try {
    // Do multiple searches to find all variants
    const searches = [
      `${cardName} ${cardNumber}`,           // "Tony Tony.Chopper 006"
      `${baseId}`,                            // "EB01-006"
      `${cardName} alternate art`,            // Find alternate arts
      `${cardName} manga`,                    // Find manga versions
    ].filter(q => q.trim());

    // Run searches in parallel
    const searchPromises = searches.map(q => searchTCGPlayer(q));
    const allResults = await Promise.all(searchPromises);

    // Combine and dedupe by productId
    const seenIds = new Set<number>();
    const combinedResults: TCGPlayerProduct[] = [];

    for (const results of allResults) {
      for (const product of results) {
        if (!seenIds.has(product.productId)) {
          seenIds.add(product.productId);
          combinedResults.push(product);
        }
      }
    }

    // Filter to only products that match our card number (if provided)
    const filteredResults = cardNumber
      ? combinedResults.filter((r) => {
          const num = r.customAttributes?.number?.toUpperCase() || '';
          const baseIdUpper = baseId.toUpperCase();
          // Match full ID (EB01-006) or just number (006)
          return num.includes(cardNumber) || num === baseIdUpper || num.replace(/-/g, '') === baseIdUpper.replace(/-/g, '');
        })
      : combinedResults;

    // Map to simplified format
    const products = filteredResults.map((r) => ({
      productId: r.productId,
      productName: r.productName,
      marketPrice: r.marketPrice,
      lowPrice: r.lowPrice,
      number: r.customAttributes?.number || '',
      url: `https://www.tcgplayer.com/product/${r.productId}/${r.productUrlName}`,
      imageUrl: `https://product-images.tcgplayer.com/fit-in/400x558/${r.productId}.jpg`,
    }));

    // Sort by product name to group variants together
    products.sort((a, b) => a.productName.localeCompare(b.productName));

    return NextResponse.json({ products, searches });
  } catch (error) {
    console.error('TCGPlayer search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
