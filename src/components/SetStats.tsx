import Link from "next/link";
import type { Card } from "@/types/card";

interface SetStatsProps {
  cards: Card[];
  setId: string;
}

function formatPrice(price: number): string {
  return price >= 1
    ? `$${price.toFixed(2)}`
    : `$${price.toFixed(2)}`;
}

export default function SetStats({ cards, setId }: SetStatsProps) {
  // Cards with valid prices
  const pricedCards = cards.filter(
    (c) => c.price?.marketPrice != null && c.price.marketPrice > 0
  );

  if (pricedCards.length === 0) return null;

  // Sort by price descending
  const sortedByPrice = [...pricedCards].sort(
    (a, b) => (b.price?.marketPrice ?? 0) - (a.price?.marketPrice ?? 0)
  );

  // ---- Core Metrics ----

  // Top 10 combined value
  const top10Cards = sortedByPrice.slice(0, 10);
  const top10Value = top10Cards.reduce(
    (sum, c) => sum + (c.price?.marketPrice ?? 0),
    0
  );

  // Chase card (#1 most expensive)
  const chaseCard = sortedByPrice[0];
  const chasePrice = chaseCard.price?.marketPrice ?? 0;

  // Total set value (all priced cards)
  const totalValue = pricedCards.reduce(
    (sum, c) => sum + (c.price?.marketPrice ?? 0),
    0
  );

  // Average card price
  const avgPrice = totalValue / pricedCards.length;

  // Median price
  const midIdx = Math.floor(pricedCards.length / 2);
  const medianPrice =
    pricedCards.length % 2 === 0
      ? ((sortedByPrice[midIdx - 1].price?.marketPrice ?? 0) +
          (sortedByPrice[midIdx].price?.marketPrice ?? 0)) /
        2
      : sortedByPrice[midIdx].price?.marketPrice ?? 0;

  // Hit rate - cards worth $5+ (rough booster pack MSRP)
  const hitsCount = pricedCards.filter(
    (c) => (c.price?.marketPrice ?? 0) >= 5
  ).length;
  const hitRate = (hitsCount / pricedCards.length) * 100;

  // Rarity breakdown (chase rarities only)
  const secCount = cards.filter((c) => c.rarity === "SEC").length;
  const srCount = cards.filter((c) => c.rarity === "SR").length;
  const spCount = cards.filter((c) => c.rarity === "SP").length;

  // Top 10 concentration: what % of total value is in the top 10
  const top10Concentration =
    totalValue > 0 ? (top10Value / totalValue) * 100 : 0;

  // Floor price (cheapest card — shows entry point)
  const floorPrice = sortedByPrice[sortedByPrice.length - 1].price?.marketPrice ?? 0;

  return (
    <div className="mb-8">
      {/* Main value metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {/* Top 10 Value - primary metric */}
        <div className="col-span-2 sm:col-span-1 bg-gradient-to-br from-yellow-500/10 to-amber-500/5 border border-yellow-500/20 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1">
            <svg className="w-4 h-4 text-yellow-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
            <span className="text-xs text-yellow-400/80 font-medium uppercase tracking-wider">Top 10 Value</span>
          </div>
          <p className="text-2xl font-bold text-yellow-400">{formatPrice(top10Value)}</p>
          <p className="text-xs text-zinc-500 mt-1">Combined top 10 cards</p>
        </div>

        {/* Chase Card */}
        <div className="bg-zinc-800/50 light:bg-zinc-100 border border-zinc-700/50 light:border-zinc-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1">
            <svg className="w-4 h-4 text-sky-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs text-zinc-400 light:text-zinc-500 font-medium uppercase tracking-wider">Chase Card</span>
          </div>
          <p className="text-2xl font-bold text-sky-400">{formatPrice(chasePrice)}</p>
          <Link
            href={`/card/${chaseCard.id.toLowerCase()}`}
            className="text-xs text-zinc-500 hover:text-sky-400 transition-colors mt-1 block truncate"
            title={chaseCard.name}
          >
            {chaseCard.name}
          </Link>
        </div>

        {/* Total Set Value */}
        <div className="bg-zinc-800/50 light:bg-zinc-100 border border-zinc-700/50 light:border-zinc-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1">
            <svg className="w-4 h-4 text-green-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <span className="text-xs text-zinc-400 light:text-zinc-500 font-medium uppercase tracking-wider">Set Total</span>
          </div>
          <p className="text-2xl font-bold text-green-400">{formatPrice(totalValue)}</p>
          <p className="text-xs text-zinc-500 mt-1">All {pricedCards.length} priced cards</p>
        </div>

        {/* Average Price */}
        <div className="bg-zinc-800/50 light:bg-zinc-100 border border-zinc-700/50 light:border-zinc-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1">
            <svg className="w-4 h-4 text-purple-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <span className="text-xs text-zinc-400 light:text-zinc-500 font-medium uppercase tracking-wider">Avg Price</span>
          </div>
          <p className="text-2xl font-bold text-purple-400">{formatPrice(avgPrice)}</p>
          <p className="text-xs text-zinc-500 mt-1">Median: {formatPrice(medianPrice)}</p>
        </div>

        {/* Hit Rate */}
        <div className="bg-zinc-800/50 light:bg-zinc-100 border border-zinc-700/50 light:border-zinc-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1">
            <svg className="w-4 h-4 text-orange-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="text-xs text-zinc-400 light:text-zinc-500 font-medium uppercase tracking-wider">Hit Rate</span>
          </div>
          <p className="text-2xl font-bold text-orange-400">{hitRate.toFixed(0)}%</p>
          <p className="text-xs text-zinc-500 mt-1">{hitsCount} cards worth $5+</p>
        </div>
      </div>

      {/* Secondary row */}
      <div className="grid grid-cols-3 sm:grid-cols-3 gap-3 mt-3">
        {/* Chase rarities */}
        <div className="bg-zinc-800/30 light:bg-zinc-50 border border-zinc-800 light:border-zinc-200 rounded-lg px-4 py-3 flex items-center justify-between">
          <span className="text-xs text-zinc-500 font-medium">Chase Rarities</span>
          <div className="flex items-center gap-2">
            {secCount > 0 && (
              <span className="text-xs font-semibold px-1.5 py-0.5 bg-red-500/15 text-red-400 rounded">
                {secCount} SEC
              </span>
            )}
            {srCount > 0 && (
              <span className="text-xs font-semibold px-1.5 py-0.5 bg-yellow-500/15 text-yellow-400 rounded">
                {srCount} SR
              </span>
            )}
            {spCount > 0 && (
              <span className="text-xs font-semibold px-1.5 py-0.5 bg-purple-500/15 text-purple-400 rounded">
                {spCount} SP
              </span>
            )}
            {secCount === 0 && srCount === 0 && spCount === 0 && (
              <span className="text-xs text-zinc-600">None</span>
            )}
          </div>
        </div>

        {/* Value concentration */}
        <div className="bg-zinc-800/30 light:bg-zinc-50 border border-zinc-800 light:border-zinc-200 rounded-lg px-4 py-3 flex items-center justify-between">
          <span className="text-xs text-zinc-500 font-medium">Top 10 Share</span>
          <span className="text-sm font-semibold text-zinc-300 light:text-zinc-700">{top10Concentration.toFixed(0)}%</span>
        </div>

        {/* Floor Price */}
        <div className="bg-zinc-800/30 light:bg-zinc-50 border border-zinc-800 light:border-zinc-200 rounded-lg px-4 py-3 flex items-center justify-between">
          <span className="text-xs text-zinc-500 font-medium">Floor Price</span>
          <span className="text-sm font-semibold text-zinc-300 light:text-zinc-700">{formatPrice(floorPrice)}</span>
        </div>
      </div>
    </div>
  );
}
