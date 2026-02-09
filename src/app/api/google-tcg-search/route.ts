import { NextResponse } from 'next/server';

interface GoogleTCGResult {
  productId: number;
  title: string;
  url: string;
  imageUrl: string;
}

// GET /api/google-tcg-search - Search for TCGPlayer products via Google Custom Search API
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    return NextResponse.json({ error: 'Query required' }, { status: 400 });
  }

  const apiKey = process.env.GOOGLE_API_KEY;
  const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;

  // If no API key, return empty results (feature disabled)
  if (!apiKey || !searchEngineId) {
    return NextResponse.json({ results: [], error: 'Google API not configured' });
  }

  try {
    const searchQuery = `${query} site:tcgplayer.com/product`;
    const googleUrl = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(searchQuery)}&num=10`;

    const response = await fetch(googleUrl);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Google API error:', response.status, errorData);
      return NextResponse.json({ results: [], error: 'Google API error' });
    }

    const data = await response.json();
    const results: GoogleTCGResult[] = [];

    // Parse Google Custom Search results
    if (data.items) {
      for (const item of data.items) {
        const url = item.link || '';
        const title = item.title || '';

        // Check if it's a TCGPlayer product URL
        const productMatch = url.match(/tcgplayer\.com\/product\/(\d+)/);
        if (productMatch) {
          const productId = parseInt(productMatch[1]);

          // Avoid duplicates
          if (!results.some(r => r.productId === productId)) {
            results.push({
              productId,
              title: title.replace(/ - TCGplayer\.com$/, '').trim(),
              url,
              imageUrl: `https://product-images.tcgplayer.com/fit-in/400x558/${productId}.jpg`,
            });
          }
        }
      }
    }

    return NextResponse.json({
      results: results.slice(0, 10),
      query: searchQuery,
    });
  } catch (error) {
    console.error('Google TCG search error:', error);
    return NextResponse.json({
      error: 'Search failed',
      results: []
    });
  }
}
