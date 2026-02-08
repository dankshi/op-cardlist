import type { Metadata } from "next";
import Link from "next/link";
import { getAllCards } from "@/lib/cards";
import { getTopPriceMovers, getPriceHistoryFiles } from "@/lib/price-history";
import { CardThumbnail } from "@/components/card/CardThumbnail";
import { PriceChangeBadge } from "@/components/PriceChangeBadge";
import { SITE_URL, SITE_NAME } from "@/lib/seo";
import type { Card } from "@/types/card";

export const metadata: Metadata = {
  title: "Hot Cards - Price Movers | One Piece TCG",
  description: "See which One Piece TCG cards are pumping and dumping. Track the biggest price gainers and losers in the market.",
  openGraph: {
    title: "Hot Cards - One Piece TCG Price Movers",
    description: "Track the biggest price gainers and losers in the One Piece TCG market.",
    url: `${SITE_URL}/hot`,
    siteName: SITE_NAME,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Hot Cards - One Piece TCG Price Movers",
    description: "See which cards are pumping and dumping!",
  },
};

// Sort cards by market price
function getTopValueCards(cards: Card[], limit: number = 20): Card[] {
  return cards
    .filter(card => card.price?.marketPrice != null && card.price.marketPrice > 0)
    .sort((a, b) => (b.price?.marketPrice || 0) - (a.price?.marketPrice || 0))
    .slice(0, limit);
}

export default function HotCardsPage() {
  const allCards = getAllCards();
  const historyFiles = getPriceHistoryFiles();
  const hasHistory = historyFiles.length > 1;

  // Get current prices for movers calculation
  const currentPrices: Record<string, number> = {};
  allCards.forEach(card => {
    if (card.price?.marketPrice != null) {
      currentPrices[card.id] = card.price.marketPrice;
    }
  });

  // Get price movers (7 day change)
  const { gainers, losers } = hasHistory
    ? getTopPriceMovers(currentPrices, 7, 10)
    : { gainers: [], losers: [] };

  // Get card objects for gainers and losers
  const cardMap = new Map(allCards.map(c => [c.id, c]));
  const gainerCards = gainers
    .map(g => ({ card: cardMap.get(g.cardId), change: g }))
    .filter((x): x is { card: Card; change: typeof gainers[0] } => x.card !== undefined);
  const loserCards = losers
    .map(l => ({ card: cardMap.get(l.cardId), change: l }))
    .filter((x): x is { card: Card; change: typeof losers[0] } => x.card !== undefined);

  // Top value cards (always available)
  const topValueCards = getTopValueCards(allCards, 20);

  return (
    <div className="min-h-screen bg-zinc-950 light:bg-white text-white light:text-zinc-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/"
            className="text-zinc-400 hover:text-white light:hover:text-zinc-900 text-sm mb-4 inline-block"
          >
            &larr; Back to Sets
          </Link>
          <h1 className="text-3xl font-bold">Hot Cards</h1>
          <p className="text-zinc-400 light:text-zinc-600 mt-2">
            {hasHistory
              ? "Track price movements and find the hottest cards in the market."
              : "Top value cards in the One Piece TCG market."}
          </p>
        </div>

        {/* Price Movers Section (only if we have history) */}
        {hasHistory && (gainerCards.length > 0 || loserCards.length > 0) && (
          <div className="grid md:grid-cols-2 gap-8 mb-12">
            {/* Gainers */}
            {gainerCards.length > 0 && (
              <div>
                <h2 className="text-xl font-bold text-green-400 mb-4 flex items-center gap-2">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                  Top Gainers (7d)
                </h2>
                <div className="space-y-3">
                  {gainerCards.map(({ card, change }) => (
                    <Link
                      key={card.id}
                      href={`/card/${card.id.toLowerCase()}`}
                      className="flex items-center gap-4 p-3 bg-zinc-900 light:bg-zinc-100 rounded-lg hover:bg-zinc-800 light:hover:bg-zinc-200 transition-colors"
                    >
                      <div className="w-12 h-16 relative flex-shrink-0">
                        <CardThumbnail card={card} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{card.name}</p>
                        <p className="text-sm text-zinc-400">{card.id}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-green-400 font-bold">
                          ${change.currentPrice.toFixed(2)}
                        </p>
                        <PriceChangeBadge changePercent={change.changePercent} size="sm" />
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Losers */}
            {loserCards.length > 0 && (
              <div>
                <h2 className="text-xl font-bold text-red-400 mb-4 flex items-center gap-2">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
                  </svg>
                  Top Losers (7d)
                </h2>
                <div className="space-y-3">
                  {loserCards.map(({ card, change }) => (
                    <Link
                      key={card.id}
                      href={`/card/${card.id.toLowerCase()}`}
                      className="flex items-center gap-4 p-3 bg-zinc-900 light:bg-zinc-100 rounded-lg hover:bg-zinc-800 light:hover:bg-zinc-200 transition-colors"
                    >
                      <div className="w-12 h-16 relative flex-shrink-0">
                        <CardThumbnail card={card} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{card.name}</p>
                        <p className="text-sm text-zinc-400">{card.id}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-red-400 font-bold">
                          ${change.currentPrice.toFixed(2)}
                        </p>
                        <PriceChangeBadge changePercent={change.changePercent} size="sm" />
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Coming Soon Notice (when no history) */}
        {!hasHistory && (
          <div className="mb-8 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
            <p className="text-amber-400">
              <strong>Price tracking just started!</strong> Check back in a few days to see price movers and trends.
            </p>
          </div>
        )}

        {/* Top Value Cards */}
        <div>
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <svg className="w-6 h-6 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Highest Value Cards
          </h2>
          <p className="text-zinc-400 light:text-zinc-600 mb-4">
            The most valuable One Piece TCG cards right now.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {topValueCards.map((card) => (
              <Link
                key={card.id}
                href={`/card/${card.id.toLowerCase()}`}
                className="block group"
              >
                <CardThumbnail card={card} />
                <div className="mt-2">
                  <p className="text-sm font-medium truncate group-hover:text-green-400 transition-colors">
                    {card.name}
                  </p>
                  <p className="text-xs text-zinc-500">{card.id}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
