import Link from "next/link";
import type { Metadata } from "next";
import { getAllSets, getAllCards, getAllSetImages } from "@/lib/cards";
import { getTopPriceMovers, getPriceHistoryFiles } from "@/lib/price-history";
import { createClient } from "@/lib/supabase/server";
import { SITE_URL, BASE_KEYWORDS } from "@/lib/seo";
import { SearchHero } from "@/components/home/SearchHero";
import { CardCarousel } from "@/components/home/CardCarousel";
import { ListingCarousel } from "@/components/home/ListingCarousel";
import { SellCTA } from "@/components/home/SellCTA";
import type { Card } from "@/types/card";
import type { EnrichedListing } from "@/components/home/ListingCarousel";

export const metadata: Metadata = {
  title: { absolute: "nomi market — The Trusted TCG Marketplace" },
  description: `Buy and sell authenticated TCG cards. Every order verified before it ships. Daily market prices across every set.`,
  keywords: [...BASE_KEYWORDS, "NOMI Market", "nomimarket", "buy sell cards", "TCG marketplace", "trading card marketplace", "authenticated cards"],
  alternates: {
    canonical: SITE_URL,
  },
};

function getSetShortName(fullName: string): string {
  const match = fullName.match(/^[A-Z0-9-]+ - (.+)$/i);
  return match ? match[1] : fullName;
}

export default async function Home() {
  const sets = getAllSets();
  const allCards = await getAllCards();
  const totalCards = sets.reduce((sum, set) => sum + set.cardCount, 0);
  const setImages = getAllSetImages();
  const cardMap = new Map(allCards.map((c) => [c.id, c]));

  // Most valuable cards (top 15 across all sets)
  const mostValuable: Card[] = allCards
    .filter((c) => c.price?.marketPrice != null && c.price.marketPrice > 0)
    .sort((a, b) => (b.price?.marketPrice ?? 0) - (a.price?.marketPrice ?? 0))
    .slice(0, 15);

  // Price movers (trending + deals)
  const historyFiles = getPriceHistoryFiles();
  const hasHistory = historyFiles.length > 1;
  let trendingCards: Card[] = [];
  let priceChanges: Record<string, number> = {};
  let dealCards: Card[] = [];
  let dealPriceChanges: Record<string, number> = {};

  if (hasHistory) {
    const currentPrices: Record<string, number> = {};
    allCards.forEach((card) => {
      if (card.price?.marketPrice != null) {
        currentPrices[card.id] = card.price.marketPrice;
      }
    });
    const { gainers, losers } = getTopPriceMovers(currentPrices, 7, 15);

    trendingCards = gainers
      .map((g) => cardMap.get(g.cardId))
      .filter((c): c is Card => c !== undefined);
    gainers.forEach((g) => {
      priceChanges[g.cardId] = g.changePercent;
    });

    dealCards = losers
      .map((l) => cardMap.get(l.cardId))
      .filter((c): c is Card => c !== undefined);
    losers.forEach((l) => {
      dealPriceChanges[l.cardId] = l.changePercent;
    });
  }

  // Newest marketplace listings
  let enrichedListings: EnrichedListing[] = [];
  try {
    const supabase = await createClient();
    const { data: recentListings } = await supabase
      .from("listings")
      .select("*, seller:profiles(display_name, username)")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(12);

    enrichedListings = (recentListings || [])
      .map((listing: any) => {
        const card = cardMap.get(listing.card_id);
        if (!card) return null;
        return {
          id: listing.id,
          card_id: listing.card_id,
          cardName: card.name,
          cardImageUrl: card.imageUrl,
          price: listing.price,
          condition: listing.condition,
          sellerName: listing.seller?.display_name || "Seller",
          createdAt: listing.created_at,
        };
      })
      .filter((l: EnrichedListing | null): l is EnrichedListing => l !== null);
  } catch {
    // Supabase unavailable — skip listings section
  }

  // Newest set + its top cards
  const sortedSets = [...sets].sort(
    (a, b) => new Date(b.releaseDate).getTime() - new Date(a.releaseDate).getTime()
  );
  const newestSet = sortedSets[0];
  const newReleaseCards: Card[] = newestSet
    ? allCards
        .filter((c) => c.setId === newestSet.id)
        .filter((c) => c.price?.marketPrice != null && c.price.marketPrice > 0)
        .sort((a, b) => (b.price?.marketPrice ?? 0) - (a.price?.marketPrice ?? 0))
        .slice(0, 15)
    : [];

  // 6 newest sets for Browse Sets section
  const newestSets = sortedSets.slice(0, 6);

  return (
    <div>
      {/* ===== HERO SECTION ===== */}
      <section className="pt-12 pb-16 sm:pt-16 sm:pb-20 mb-12 sm:mb-16">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight mb-6">
            The trusted way to buy &amp; sell TCG cards.
          </h1>

          <p className="text-lg text-zinc-500 mb-10 max-w-lg mx-auto leading-relaxed">
            Every order authenticated. Every card verified before it ships.
          </p>

          <SearchHero />

          <div className="flex items-center justify-center gap-3 mt-6">
            <Link
              href="/search"
              className="px-6 py-2.5 bg-zinc-900 text-white text-sm font-medium rounded-lg hover:bg-zinc-800 transition-colors"
            >
              Browse Cards
            </Link>
            <Link
              href="/sell"
              className="px-6 py-2.5 border border-zinc-300 text-zinc-700 text-sm font-medium rounded-lg hover:bg-zinc-100 transition-colors"
            >
              Start Selling
            </Link>
          </div>

          <div className="flex items-center justify-center gap-3 mt-8 text-xs text-zinc-400">
            <span>One Piece TCG</span>
            <span className="text-zinc-300">&middot;</span>
            <span>Pokemon TCG</span>
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

      {/* ===== BEST DEALS ===== */}
      {dealCards.length > 0 && (
        <section className="mb-12 sm:mb-16">
          <CardCarousel
            title="Best Deals"
            subtitle="Cards with the biggest price drops this week"
            icon={
              <svg
                className="w-6 h-6 text-orange-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z"
                />
              </svg>
            }
            cards={dealCards}
            showPriceChange
            priceChanges={dealPriceChanges}
            viewAllHref="/hot"
          />
        </section>
      )}

      {/* ===== NEWEST LISTINGS ===== */}
      {enrichedListings.length > 0 && (
        <section className="mb-12 sm:mb-16">
          <ListingCarousel
            title="Newest Listings"
            subtitle="Just listed on the marketplace"
            icon={
              <svg
                className="w-6 h-6 text-orange-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
                />
              </svg>
            }
            listings={enrichedListings}
          />
        </section>
      )}

      {/* ===== NEW RELEASES ===== */}
      {newReleaseCards.length > 0 && newestSet && (
        <section className="mb-12 sm:mb-16">
          <CardCarousel
            title={`New: ${getSetShortName(newestSet.name)}`}
            subtitle={`Top cards from the latest set, ${newestSet.id.toUpperCase()}`}
            icon={
              <svg
                className="w-6 h-6 text-orange-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
                />
              </svg>
            }
            cards={newReleaseCards}
            viewAllHref={`/${newestSet.id}`}
          />
        </section>
      )}

      <div className="section-divider mb-12 sm:mb-16" />

      {/* ===== SELL CTA ===== */}
      <SellCTA />

      {/* ===== BROWSE SETS ===== */}
      <section className="mb-12 sm:mb-16">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold">Browse Sets</h2>
            <p className="text-sm text-zinc-500 mt-1">
              Explore the latest releases
            </p>
          </div>
          <Link
            href="/search"
            className="text-sm text-orange-500 hover:text-orange-600 transition-colors"
          >
            View all {sets.length} sets &rarr;
          </Link>
        </div>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
          {newestSets.map((set) => {
            const setImage = setImages[set.id];
            return (
              <Link
                key={set.id}
                href={`/${set.id}`}
                className="block bg-white rounded-lg border border-zinc-200 hover:border-zinc-300 hover:shadow-sm transition-all group overflow-hidden"
              >
                {setImage?.boosterBoxImageUrl && (
                  <div className="relative w-full aspect-square bg-white">
                    <img
                      src={setImage.boosterBoxImageUrl}
                      alt={`${set.name} Booster Box`}
                      className="w-full h-full object-contain p-2 group-hover:scale-105 transition-transform duration-300"
                    />
                  </div>
                )}
                <div className="p-2 text-center">
                  <h3 className="font-semibold text-sm group-hover:text-orange-500 transition-colors">
                    {set.id.toUpperCase()}
                  </h3>
                  <p className="text-zinc-500 text-xs mt-0.5 line-clamp-1">
                    {getSetShortName(set.name)}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Schema markup */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebPage",
            name: "NOMI Market - The Trusted TCG Marketplace",
            description: `Buy and sell ${totalCards} authenticated TCG cards across ${sets.length} sets with daily price updates`,
            url: SITE_URL,
          }),
        }}
      />
    </div>
  );
}
