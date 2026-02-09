import { NextResponse } from 'next/server';

interface GoogleTCGResult {
  productId: number;
  title: string;
  url: string;
  imageUrl: string;
}

// GET /api/google-tcg-search - Search for TCGPlayer products via DuckDuckGo
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    return NextResponse.json({ error: 'Query required' }, { status: 400 });
  }

  try {
    // Use DuckDuckGo HTML search (more permissive than Google)
    const searchQuery = `${query} site:tcgplayer.com/product`;
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;

    const response = await fetch(ddgUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo request failed: ${response.status}`);
    }

    const html = await response.text();

    // Parse the HTML to extract TCGPlayer links
    const results: GoogleTCGResult[] = [];

    // Match TCGPlayer product URLs and titles from DuckDuckGo results
    // DuckDuckGo HTML format: <a class="result__a" href="...">title</a>
    const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
    let match;

    while ((match = linkRegex.exec(html)) !== null) {
      const url = match[1];
      const title = match[2].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');

      // Check if it's a TCGPlayer product URL
      const productMatch = url.match(/tcgplayer\.com\/product\/(\d+)/);
      if (productMatch) {
        const productId = parseInt(productMatch[1]);

        // Avoid duplicates
        if (!results.some(r => r.productId === productId)) {
          results.push({
            productId,
            title: title.trim(),
            url: url.startsWith('//') ? `https:${url}` : url,
            imageUrl: `https://product-images.tcgplayer.com/fit-in/400x558/${productId}.jpg`,
          });
        }
      }
    }

    // Also try alternate regex pattern for encoded URLs
    const encodedLinkRegex = /uddg=([^&"]+)/gi;
    while ((match = encodedLinkRegex.exec(html)) !== null) {
      try {
        const decodedUrl = decodeURIComponent(match[1]);
        const productMatch = decodedUrl.match(/tcgplayer\.com\/product\/(\d+)/);
        if (productMatch) {
          const productId = parseInt(productMatch[1]);
          if (!results.some(r => r.productId === productId)) {
            results.push({
              productId,
              title: `TCGPlayer Product #${productId}`,
              url: decodedUrl,
              imageUrl: `https://product-images.tcgplayer.com/fit-in/400x558/${productId}.jpg`,
            });
          }
        }
      } catch {
        // Skip malformed URLs
      }
    }

    return NextResponse.json({
      results: results.slice(0, 10), // Limit to 10 results
      query: searchQuery,
    });
  } catch (error) {
    console.error('Google TCG search error:', error);
    return NextResponse.json({
      error: 'Search failed',
      results: []
    }, { status: 500 });
  }
}
