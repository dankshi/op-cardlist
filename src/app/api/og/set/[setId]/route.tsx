import { ImageResponse } from '@vercel/og';
import { getSetBySlug } from '@/lib/cards';
import { getSetShortName } from '@/lib/seo';

export const runtime = 'edge';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ setId: string }> }
) {
  const { setId } = await params;
  const set = await getSetBySlug(setId);

  if (!set) {
    return new Response('Set not found', { status: 404 });
  }

  const shortName = getSetShortName(set.name);
  const setUpper = set.id.toUpperCase();

  // Top 3 most expensive cards
  const topCards = set.cards
    .filter((c) => c.price?.marketPrice != null && c.price.marketPrice > 0)
    .sort((a, b) => (b.price?.marketPrice ?? 0) - (a.price?.marketPrice ?? 0))
    .slice(0, 3);

  // Total set value
  const totalValue = set.cards
    .filter((c) => c.price?.marketPrice != null)
    .reduce((sum, c) => sum + (c.price?.marketPrice ?? 0), 0);

  const formatPrice = (price: number) =>
    price >= 1000 ? `$${(price / 1000).toFixed(1)}k` : `$${price.toFixed(2)}`;

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#09090b',
          padding: '40px 50px',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '30px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <span
                style={{
                  color: '#38bdf8',
                  fontSize: '48px',
                  fontWeight: 'bold',
                  fontStyle: 'italic',
                }}
              >
                {setUpper}
              </span>
              <span style={{ color: '#a1a1aa', fontSize: '32px' }}>·</span>
              <span style={{ color: '#e4e4e7', fontSize: '32px' }}>{shortName}</span>
            </div>
            <span style={{ color: '#71717a', fontSize: '20px', marginTop: '4px' }}>
              {set.cardCount} cards
            </span>
          </div>
          {totalValue > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                padding: '12px 28px',
                borderRadius: '16px',
              }}
            >
              <span
                style={{ color: '#ffffff', fontSize: '36px', fontWeight: 'bold' }}
              >
                {formatPrice(totalValue)}
              </span>
              <span
                style={{
                  color: 'rgba(255,255,255,0.8)',
                  fontSize: '16px',
                  textTransform: 'uppercase',
                }}
              >
                Set Value
              </span>
            </div>
          )}
        </div>

        {/* Top 3 chase cards */}
        <div
          style={{
            display: 'flex',
            flex: 1,
            gap: '24px',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {topCards.map((card, i) => (
            <div
              key={card.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  borderRadius: '12px',
                  boxShadow:
                    i === 0
                      ? '0 0 40px rgba(234,179,8,0.3)'
                      : '0 0 20px rgba(255,255,255,0.1)',
                  border:
                    i === 0
                      ? '2px solid rgba(234,179,8,0.5)'
                      : '1px solid rgba(255,255,255,0.1)',
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={card.imageUrl}
                  alt={card.name}
                  width={i === 0 ? 160 : 140}
                  height={i === 0 ? 224 : 196}
                  style={{ borderRadius: '10px', objectFit: 'cover' }}
                />
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                }}
              >
                <span
                  style={{
                    color: '#22c55e',
                    fontSize: '24px',
                    fontWeight: 'bold',
                  }}
                >
                  {formatPrice(card.price?.marketPrice ?? 0)}
                </span>
                <span
                  style={{
                    color: '#a1a1aa',
                    fontSize: '14px',
                    maxWidth: '150px',
                    textAlign: 'center',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {card.name}
                </span>
              </div>
            </div>
          ))}

          {topCards.length === 0 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span style={{ color: '#71717a', fontSize: '24px' }}>
                {set.cardCount} cards
              </span>
              <span style={{ color: '#52525b', fontSize: '16px' }}>
                No price data available yet
              </span>
            </div>
          )}
        </div>

        {/* Footer branding */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: '20px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                color: '#38bdf8',
                fontSize: '24px',
                fontWeight: 'bold',
                fontStyle: 'italic',
              }}
            >
              OP
            </span>
            <span
              style={{ color: '#e4e4e7', fontSize: '20px', fontWeight: 'bold' }}
            >
              Card
            </span>
            <span
              style={{ color: '#71717a', fontSize: '20px', fontWeight: 'bold' }}
            >
              list
            </span>
          </div>
          <span style={{ color: '#52525b', fontSize: '16px' }}>
            opcardlist.com
          </span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
