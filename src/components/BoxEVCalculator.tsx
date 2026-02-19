import type { Card } from '@/types/card';
import { calculateBoxEV } from '@/lib/box-ev';

interface BoxEVCalculatorProps {
  cards: Card[];
  msrp?: number;
}

function formatPrice(price: number): string {
  return price >= 1000
    ? `$${(price / 1000).toFixed(1)}k`
    : `$${price.toFixed(2)}`;
}

export default function BoxEVCalculator({ cards, msrp }: BoxEVCalculatorProps) {
  const result = calculateBoxEV(cards, msrp);

  if (result.rarityBreakdown.length === 0) return null;

  const verdictColors = {
    'worth-opening': {
      bg: 'bg-green-500/10 border-green-500/20',
      text: 'text-green-400',
      badge: 'bg-green-500/20 text-green-400',
    },
    'break-even': {
      bg: 'bg-amber-500/10 border-amber-500/20',
      text: 'text-amber-400',
      badge: 'bg-amber-500/20 text-amber-400',
    },
    'buy-singles': {
      bg: 'bg-red-500/10 border-red-500/20',
      text: 'text-red-400',
      badge: 'bg-red-500/20 text-red-400',
    },
  };

  const colors = verdictColors[result.verdict];

  return (
    <section className="mb-8">
      <h2 className="text-xl font-bold mb-4">Box Expected Value (EV)</h2>
      <div className={`border rounded-lg p-5 ${colors.bg}`}>
        {/* Top row: EV vs MSRP */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">
              Box EV
            </p>
            <p className={`text-3xl font-bold ${colors.text}`}>
              {formatPrice(result.ev)}
            </p>
          </div>
          <div className="text-center">
            <span
              className={`inline-block px-3 py-1.5 rounded-lg text-sm font-semibold ${colors.badge}`}
            >
              {result.verdictLabel}
            </span>
            <p className="text-xs text-zinc-500 mt-1">
              {(result.ratio * 100).toFixed(0)}% of MSRP
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">
              Box MSRP
            </p>
            <p className="text-2xl font-bold text-zinc-300 light:text-zinc-700">
              {formatPrice(result.msrp)}
            </p>
          </div>
        </div>

        {/* Rarity breakdown */}
        <div className="space-y-2">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">
            EV by Rarity
          </p>
          {result.rarityBreakdown.map((r) => (
            <div
              key={r.rarity}
              className="flex items-center justify-between text-sm"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-zinc-300 light:text-zinc-700 w-16">
                  {r.rarity}
                </span>
                <span className="text-zinc-500">
                  {r.count} cards · avg {formatPrice(r.avgPrice)}
                </span>
              </div>
              <span className="font-semibold text-zinc-200 light:text-zinc-800">
                {formatPrice(r.evContribution)}
              </span>
            </div>
          ))}
        </div>

        <p className="text-xs text-zinc-600 mt-3">
          Based on approximate pull rates (24 packs/box). Actual results vary.
        </p>
      </div>
    </section>
  );
}
