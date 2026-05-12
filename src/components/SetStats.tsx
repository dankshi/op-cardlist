import type { Card } from "@/types/card";

interface SetStatsProps {
  cards: Card[];
}

function formatPrice(price: number): string {
  return `$${price.toFixed(2)}`;
}

export default function SetStats({ cards }: SetStatsProps) {
  const pricedCards = cards.filter(
    (c) => c.price?.marketPrice != null && c.price.marketPrice > 0,
  );
  if (pricedCards.length === 0) return null;

  const sortedByPrice = [...pricedCards].sort(
    (a, b) => (b.price?.marketPrice ?? 0) - (a.price?.marketPrice ?? 0),
  );
  const top10Value = sortedByPrice
    .slice(0, 10)
    .reduce((sum, c) => sum + (c.price?.marketPrice ?? 0), 0);

  return (
    <div className="mb-6">
      <div className="inline-flex flex-col bg-gradient-to-br from-yellow-500/10 to-amber-500/5 border border-yellow-500/20 rounded-lg px-5 py-4">
        <div className="flex items-center gap-2 mb-1">
          <svg className="w-4 h-4 text-yellow-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
          <span className="text-xs text-yellow-500 font-medium uppercase tracking-wider">Top 10 Value</span>
        </div>
        <p className="text-2xl font-bold text-yellow-500">{formatPrice(top10Value)}</p>
        <p className="text-xs text-zinc-500 mt-1">Combined top 10 cards</p>
      </div>
    </div>
  );
}
