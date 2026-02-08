import { ImageResponse } from '@vercel/og';
import { getCardById } from '@/lib/cards';

export const runtime = 'edge';

// Color mapping for card colors
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
  const card = getCardById(cardId.toUpperCase());

  if (!card) {
    return new Response('Card not found', { status: 404 });
  }

  const price = card.price?.marketPrice;
  const hasPrice = price != null;

  // Format price nicely
  const formattedPrice = hasPrice
    ? price >= 1000
      ? `$${(price / 1000).toFixed(1)}k`
      : `$${price.toFixed(2)}`
    : null;

  // Get primary color
  const primaryColor = card.colors[0] ? colorMap[card.colors[0]] : '#6b7280';

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#09090b',
          padding: '40px',
        }}
      >
        {/* Left side - Card Image */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            marginRight: '60px',
          }}
        >
          {/* Card with glow effect */}
          <div
            style={{
              display: 'flex',
              position: 'relative',
              borderRadius: '16px',
              boxShadow: `0 0 60px ${primaryColor}40`,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={card.imageUrl}
              alt={card.name}
              width={280}
              height={392}
              style={{
                borderRadius: '12px',
                objectFit: 'cover',
              }}
            />
            {/* Parallel badge */}
            {card.isParallel && (
              <div
                style={{
                  position: 'absolute',
                  top: '12px',
                  right: '12px',
                  background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
                  color: '#000',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 'bold',
                }}
              >
                {card.artStyle === 'wanted' ? 'WANTED' : card.artStyle === 'manga' ? 'MANGA' : 'ALT ART'}
              </div>
            )}
          </div>
        </div>

        {/* Right side - Card Info */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            maxWidth: '500px',
          }}
        >
          {/* Card ID and Set */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              marginBottom: '12px',
            }}
          >
            <span
              style={{
                color: '#a1a1aa',
                fontSize: '24px',
                fontFamily: 'monospace',
              }}
            >
              {card.id}
            </span>
            <span
              style={{
                background: '#27272a',
                color: '#e4e4e7',
                padding: '4px 12px',
                borderRadius: '6px',
                fontSize: '18px',
              }}
            >
              {card.rarity}
            </span>
          </div>

          {/* Card Name */}
          <h1
            style={{
              color: '#ffffff',
              fontSize: '48px',
              fontWeight: 'bold',
              margin: '0 0 20px 0',
              lineHeight: 1.1,
            }}
          >
            {card.name}
          </h1>

          {/* Color dots */}
          <div
            style={{
              display: 'flex',
              gap: '8px',
              marginBottom: '24px',
            }}
          >
            {card.colors.map((color) => (
              <div
                key={color}
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  backgroundColor: colorMap[color],
                }}
              />
            ))}
          </div>

          {/* Price Badge - THE MAIN VIRAL ELEMENT */}
          {hasPrice && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
                background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                padding: '16px 32px',
                borderRadius: '16px',
                marginBottom: '24px',
              }}
            >
              <span
                style={{
                  color: '#ffffff',
                  fontSize: '56px',
                  fontWeight: 'bold',
                }}
              >
                {formattedPrice}
              </span>
              <span
                style={{
                  color: 'rgba(255,255,255,0.8)',
                  fontSize: '20px',
                  textTransform: 'uppercase',
                }}
              >
                Market Price
              </span>
            </div>
          )}

          {/* Stats row */}
          <div
            style={{
              display: 'flex',
              gap: '24px',
            }}
          >
            {card.power != null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: '#71717a', fontSize: '18px' }}>Power</span>
                <span style={{ color: '#ffffff', fontSize: '24px', fontWeight: 'bold' }}>
                  {card.power.toLocaleString()}
                </span>
              </div>
            )}
            {card.cost != null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: '#71717a', fontSize: '18px' }}>Cost</span>
                <span style={{ color: '#ffffff', fontSize: '24px', fontWeight: 'bold' }}>
                  {card.cost}
                </span>
              </div>
            )}
            {card.type === 'LEADER' && card.life != null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: '#71717a', fontSize: '18px' }}>Life</span>
                <span style={{ color: '#ffffff', fontSize: '24px', fontWeight: 'bold' }}>
                  {card.life}
                </span>
              </div>
            )}
          </div>

          {/* Site branding */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              marginTop: '32px',
              gap: '8px',
            }}
          >
            <span
              style={{
                color: '#71717a',
                fontSize: '20px',
              }}
            >
              opcardlist.com
            </span>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
