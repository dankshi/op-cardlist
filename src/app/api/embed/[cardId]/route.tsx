import { getCardById } from '@/lib/cards';
import { SITE_URL } from '@/lib/seo';

const colorMap: Record<string, string> = {
  Red: '#ef4444',
  Green: '#22c55e',
  Blue: '#3b82f6',
  Purple: '#a855f7',
  Black: '#52525b',
  Yellow: '#eab308',
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ cardId: string }> }
) {
  const { cardId } = await params;
  const card = await getCardById(cardId.toUpperCase());

  if (!card) {
    return new Response('Card not found', { status: 404 });
  }

  const cardUrl = `${SITE_URL}/card/${card.id.toLowerCase()}`;
  const price = card.price?.marketPrice;
  const priceHtml =
    price != null ? `<div class="price">$${price.toFixed(2)}</div>` : '';

  const colorDots = card.colors
    .map(
      (c) =>
        `<span class="color-dot" style="background:${colorMap[c] || '#6b7280'}"></span>`
    )
    .join('');

  // Escape HTML entities in card name for safe embedding
  const safeName = card.name
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeName} - ${card.id}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #09090b;
      color: #e4e4e7;
    }
    a { color: inherit; text-decoration: none; }
    .widget {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 16px;
      max-width: 350px;
      margin: 0 auto;
    }
    .card-image {
      width: 200px;
      height: 280px;
      border-radius: 10px;
      object-fit: cover;
      margin-bottom: 12px;
    }
    .card-id {
      color: #a1a1aa;
      font-family: monospace;
      font-size: 14px;
      margin-bottom: 4px;
    }
    .card-name {
      font-size: 20px;
      font-weight: bold;
      margin-bottom: 8px;
      text-align: center;
    }
    .meta {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      flex-wrap: wrap;
      justify-content: center;
    }
    .badge {
      background: #27272a;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
    }
    .colors {
      display: flex;
      gap: 6px;
      margin-bottom: 12px;
    }
    .color-dot {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      display: inline-block;
    }
    .price {
      font-size: 28px;
      font-weight: bold;
      color: #4ade80;
      margin-bottom: 12px;
    }
    .branding {
      font-size: 11px;
      color: #52525b;
      margin-top: 8px;
    }
    .branding span {
      color: #38bdf8;
      font-weight: bold;
      font-style: italic;
    }
  </style>
</head>
<body>
  <a href="${cardUrl}" target="_blank" rel="noopener noreferrer">
    <div class="widget">
      <img class="card-image" src="${card.imageUrl}" alt="${safeName}" />
      <div class="card-id">${card.id}</div>
      <div class="card-name">${safeName}</div>
      <div class="meta">
        <span class="badge">${card.rarity}</span>
        <span class="badge">${card.type}</span>
      </div>
      <div class="colors">${colorDots}</div>
      ${priceHtml}
      <div class="branding"><span>OP</span>Cardlist &middot; opcardlist.com</div>
    </div>
  </a>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': 'frame-ancestors *',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
