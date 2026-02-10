import Link from "next/link";
import type { Metadata } from "next";
import { getAllSets, getAllCards, getLastUpdated, getAllSetImages } from "@/lib/cards";
import { getTopPriceMovers, getPriceHistoryFiles } from "@/lib/price-history";
import { SITE_URL, SITE_DESCRIPTION, BASE_KEYWORDS } from "@/lib/seo";
import { SearchHero } from "@/components/home/SearchHero";
import { CardCarousel } from "@/components/home/CardCarousel";
import type { Card } from "@/types/card";

export const metadata: Metadata = {
  title: "One Piece TCG Card List - The Ultimate Database with Prices | All Sets",
  description: `${SITE_DESCRIPTION} Browse OP-13, EB-03, and all One Piece TCG sets with TCGPlayer market prices.`,
  keywords: [...BASE_KEYWORDS, "all sets", "complete database", "OP-13", "EB-03", "price guide"],
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
      <section className="hero-gradient relative -mx-4 px-4 pt-8 pb-16 sm:pt-12 sm:pb-20 mb-12 sm:mb-16">
        {/* Subtle dot pattern */}
        <div
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage:
              "radial-gradient(circle, currentColor 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />

        <div className="relative max-w-3xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 mb-6 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-500 light:text-sky-600 text-sm font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
            {totalCards.toLocaleString()} cards indexed
          </div>

          {/* Heading */}
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight mb-4 sm:mb-6">
            The Ultimate
            <span className="block text-sky-500 drop-shadow-[0_0_30px_rgba(14,165,233,0.3)]">
              One Piece TCG
            </span>
            Database
          </h1>

          {/* Subtitle */}
          <p className="text-lg sm:text-xl text-zinc-400 light:text-zinc-600 mb-8 sm:mb-10 max-w-xl mx-auto leading-relaxed">
            Every card. Every set. Every price. The fastest way to search,
            browse, and track the One Piece Trading Card Game.
          </p>

          {/* Search Bar */}
          <SearchHero />

          {/* Stats row */}
          <div className="flex items-center justify-center gap-6 sm:gap-8 mt-8 text-sm text-zinc-500">
            <div className="text-center">
              <p className="text-lg sm:text-xl font-bold text-zinc-200 light:text-zinc-800">
                {totalCards.toLocaleString()}
              </p>
              <p>Cards</p>
            </div>
            <div className="w-px h-8 bg-zinc-800 light:bg-zinc-200" />
            <div className="text-center">
              <p className="text-lg sm:text-xl font-bold text-zinc-200 light:text-zinc-800">
                {sets.length}
              </p>
              <p>Sets</p>
            </div>
            <div className="w-px h-8 bg-zinc-800 light:bg-zinc-200" />
            <div className="text-center">
              <p className="text-lg sm:text-xl font-bold text-zinc-200 light:text-zinc-800">
                Daily
              </p>
              <p>Price Updates</p>
            </div>
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
                className="block bg-zinc-900 light:bg-white rounded-lg border border-zinc-800 light:border-zinc-200 hover:border-zinc-700 light:hover:border-zinc-300 hover:bg-zinc-800/50 light:hover:bg-zinc-50 transition-all group overflow-hidden"
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
                  <p className="text-zinc-400 light:text-zinc-600 text-xs mt-0.5 line-clamp-1">
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
            name: "One Piece TCG Card List - All Sets",
            description: `Complete database of ${totalCards} One Piece TCG cards across ${sets.length} sets with prices`,
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
