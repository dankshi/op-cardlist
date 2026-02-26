import Link from "next/link";
import type { Metadata } from "next";
import { getAllSets, getAllCards, getLastUpdated, getAllSetImages } from "@/lib/cards";
import { getTopPriceMovers, getPriceHistoryFiles } from "@/lib/price-history";
import { SITE_URL, SITE_DESCRIPTION, BASE_KEYWORDS } from "@/lib/seo";
import { SearchHero } from "@/components/home/SearchHero";
import { CardCarousel } from "@/components/home/CardCarousel";
import type { Card } from "@/types/card";

export const metadata: Metadata = {
  title: { absolute: "nomi market — The Trusted TCG Marketplace" },
  description: `Buy and sell authenticated TCG cards. Every order verified in-hand from Los Angeles before it ships. Daily market prices across every set.`,
  keywords: [...BASE_KEYWORDS, "NOMI Market", "nomimarket", "buy sell cards", "TCG marketplace", "trading card marketplace", "authenticated cards"],
  alternates: {
    canonical: SITE_URL,
  },
};

export default async function Home() {
  const sets = getAllSets();
  const allCards = await getAllCards();
  const lastUpdated = getLastUpdated();
  const totalCards = sets.reduce((sum, set) => sum + set.cardCount, 0);
  const setImages = getAllSetImages();

  // Most valuable cards (top 15 across all sets)
  const mostValuable: Card[] = allCards
    .filter((c) => c.price?.marketPrice != null && c.price.marketPrice > 0)
    .sort((a, b) => (b.price?.marketPrice ?? 0) - (a.price?.marketPrice ?? 0))
    .slice(0, 15);

  // Trending cards (price movers)
  const historyFiles = getPriceHistoryFiles();
  const hasHistory = historyFiles.length > 1;
  let trendingCards: Card[] = [];
  let priceChanges: Record<string, number> = {};

  if (hasHistory) {
    const currentPrices: Record<string, number> = {};
    allCards.forEach((card) => {
      if (card.price?.marketPrice != null) {
        currentPrices[card.id] = card.price.marketPrice;
      }
    });
    const { gainers } = getTopPriceMovers(currentPrices, 7, 15);
    const cardMap = new Map(allCards.map((c) => [c.id, c]));
    trendingCards = gainers
      .map((g) => cardMap.get(g.cardId))
      .filter((c): c is Card => c !== undefined);
    gainers.forEach((g) => {
      priceChanges[g.cardId] = g.changePercent;
    });
  }

  return (
    <div>
      {/* ===== HERO SECTION ===== */}
      <section className="pt-12 pb-16 sm:pt-16 sm:pb-20 mb-12 sm:mb-16">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight mb-6">
            The trusted way to buy &amp; sell TCG cards.
          </h1>

          <p className="text-lg text-zinc-500 mb-10 max-w-lg mx-auto leading-relaxed">
            Every order authenticated. Every card verified in-hand
            from Los Angeles, CA before it ships.
          </p>

          <SearchHero />

          <div className="flex items-center justify-center gap-8 mt-10 text-sm text-zinc-400">
            <span>{totalCards.toLocaleString()}+ cards</span>
            <span className="text-zinc-300">|</span>
            <span>{sets.length} sets</span>
            <span className="text-zinc-300">|</span>
            <span>Daily prices</span>
          </div>
        </div>
      </section>

      {/* ===== MOST VALUABLE ===== */}
      {mostValuable.length > 0 && (
        <section className="mb-12 sm:mb-16">
          <CardCarousel
            title="Most Valuable Cards"
            subtitle="The highest-priced cards across all sets"
            icon={
              <svg
                className="w-6 h-6 text-yellow-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            }
            cards={mostValuable}
            viewAllHref="/hot"
          />
        </section>
      )}

      {/* ===== TRENDING ===== */}
      {trendingCards.length > 0 && (
        <section className="mb-12 sm:mb-16">
          <CardCarousel
            title="Trending This Week"
            subtitle="Biggest price gainers in the last 7 days"
            icon={
              <svg
                className="w-6 h-6 text-green-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                />
              </svg>
            }
            cards={trendingCards}
            showPriceChange
            priceChanges={priceChanges}
            viewAllHref="/hot"
          />
        </section>
      )}

      <div className="section-divider mb-12 sm:mb-16" />

      {/* ===== ALL SETS GRID ===== */}
      <section>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold">All Sets</h2>
          <span className="text-sm text-zinc-500">
            Last updated: {new Date(lastUpdated).toLocaleDateString()}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {sets.map((set) => {
            const setImage = setImages[set.id];
            return (
              <Link
                key={set.id}
                href={`/${set.id}`}
                className="block bg-white rounded-lg border border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 transition-all group overflow-hidden"
              >
                {setImage?.boosterBoxImageUrl && (
                  <div className="relative w-full aspect-square bg-white">
                    <img
                      src={setImage.boosterBoxImageUrl}
                      alt={`${set.name} Booster Box`}
                      className="w-full h-full object-contain p-3 group-hover:scale-105 transition-transform duration-300"
                    />
                  </div>
                )}
                <div className="p-3">
                  <h3 className="font-semibold text-sm group-hover:text-sky-500 transition-colors">
                    {set.id.toUpperCase()}
                  </h3>
                  <p className="text-zinc-600 text-xs mt-0.5 line-clamp-1">
                    {set.name}
                  </p>
                  <span className="text-zinc-500 text-xs mt-1 block">
                    {set.cardCount} cards
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* CollectionPage Schema for homepage */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: "NOMI Market - One Piece TCG Marketplace",
            description: `Buy and sell ${totalCards} One Piece TCG cards across ${sets.length} sets with daily price updates`,
            url: SITE_URL,
            mainEntity: {
              "@type": "ItemList",
              name: "One Piece TCG Sets",
              numberOfItems: sets.length,
              itemListElement: sets.map((set, index) => ({
                "@type": "ListItem",
                position: index + 1,
                url: `${SITE_URL}/${set.id}`,
                name: `${set.id.toUpperCase()} - ${set.name}`,
                description: `${set.cardCount} cards`,
              })),
            },
          }),
        }}
      />
    </div>
  );
}
