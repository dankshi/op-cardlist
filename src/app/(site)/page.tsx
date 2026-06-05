import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { getAllSets, getBrowsableCards, getAllSetImages } from "@/lib/cards";
import { getTopPriceMovers, getPriceHistoryFiles } from "@/lib/price-history";
import { createClient } from "@/lib/supabase/server";
import { SITE_URL, BASE_KEYWORDS } from "@/lib/seo";
import { CardCarousel } from "@/components/home/CardCarousel";
import { ListingCarousel } from "@/components/home/ListingCarousel";
import { LaunchRaffleBanner } from "@/components/home/LaunchRaffleBanner";
import { RecentlyViewed } from "@/components/home/RecentlyViewed";
import { OfferCarousel } from "@/components/home/OfferCarousel";
import type { Card } from "@/types/card";
import type { EnrichedListing } from "@/components/home/ListingCarousel";
import type { EnrichedOffer } from "@/components/home/OfferCarousel";

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
  const [sets, allCards] = await Promise.all([getAllSets(), getBrowsableCards()]);
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

  // Newest marketplace listings — but only the ones that are *currently the
  // lowest active price for their card*. Turns the section into a "new lows"
  // / snipe feed instead of a chronological dump. A new listing only appears
  // here if it undercuts (or matches) every other active listing for that
  // same card, so buyers can act on real new lows.
  let enrichedListings: EnrichedListing[] = [];
  let topOffers: EnrichedOffer[] = [];
  try {
    const supabase = await createClient();

    // Pull a wider batch than we'll display so filtering doesn't leave the
    // section empty on busy days.
    const { data: recentListings } = await supabase
      .from("listings")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(50);

    // Look up the current min active price for each card we're considering.
    const candidateCardIds = Array.from(
      new Set((recentListings || []).map((l: { card_id: string }) => l.card_id)),
    );
    const minByCard = new Map<string, number>();
    if (candidateCardIds.length > 0) {
      const { data: minPrices } = await supabase
        .from("listings")
        .select("card_id, price")
        .eq("status", "active")
        .in("card_id", candidateCardIds);
      for (const row of minPrices || []) {
        const p = Number(row.price);
        const cur = minByCard.get(row.card_id);
        if (cur == null || p < cur) minByCard.set(row.card_id, p);
      }
    }

    // Keep only listings whose price matches the current min for their card.
    // Dedup by card_id so each card surfaces at most once (the newest
    // qualifying listing).
    const seen = new Set<string>();
    const mapped = (recentListings || [])
      .filter((listing: { card_id: string; price: number | string }) => {
        const min = minByCard.get(listing.card_id);
        return min != null && Number(listing.price) <= min + 0.001;
      })
      .filter((listing: { card_id: string }) => {
        if (seen.has(listing.card_id)) return false;
        seen.add(listing.card_id);
        return true;
      })
      .slice(0, 12)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
          grading_company: listing.grading_company || null,
          grade: listing.grade || null,
          createdAt: listing.created_at,
        } as EnrichedListing;
      });
    enrichedListings = mapped.filter((l: EnrichedListing | null): l is EnrichedListing => l !== null);

    // Top active offers — highest bids on any card from the last 14 days
    // that haven't been filled/cancelled/expired. Acts as a buyer-side
    // discovery surface: "here's what people are willing to pay big
    // money for right now — do you have one?" Mirrors "Just Listed" on
    // the seller side.
    const sinceOffers = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    // Pull a wider batch — we dedup by card_id below, so a chase card
    // with 7 grade-tier offers consumes 7 raw rows but only earns 1 tile.
    // Need enough headroom to still land 12 unique cards on a busy day.
    const { data: rawOffers } = await supabase
      .from('bids')
      .select('id, card_id, price, grading_company, grade, created_at, expires_at, status')
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .gte('created_at', sinceOffers)
      .order('price', { ascending: false })
      .limit(100);

    // Dedup by card_id so the carousel surfaces *variety* — one tile per
    // card, showing its single highest offer across every grade tier.
    // Without this, a chase card with offers on raw + PSA 10 + BGS 10 +
    // CGC 10 etc. pushes that one card's art across seven tiles and
    // visually crowds out the rest of the marketplace. Query is already
    // price-desc, so the first row seen per card is its top offer.
    const seenCardId = new Set<string>();
    topOffers = ((rawOffers || []) as Array<{
      id: string;
      card_id: string;
      price: number | string;
      grading_company: string | null;
      grade: string | null;
      created_at: string;
    }>)
      .filter(o => {
        if (seenCardId.has(o.card_id)) return false;
        seenCardId.add(o.card_id);
        return true;
      })
      .map(o => {
        const card = cardMap.get(o.card_id);
        if (!card) return null;
        return {
          id: o.id,
          card_id: o.card_id,
          cardName: card.name,
          cardImageUrl: card.imageUrl,
          price: Number(o.price),
          grading_company: o.grading_company,
          grade: o.grade,
          createdAt: o.created_at,
        } as EnrichedOffer;
      })
      .filter((o): o is EnrichedOffer => o !== null)
      .slice(0, 12);
  } catch {
    // Supabase unavailable — skip listings section
  }

  // Newest set + its top cards. A brand-new set (e.g. a pre-release that's
  // been scraped from Bandai but not yet priced on TCGplayer) has no priced
  // cards, which would make this carousel render empty and disappear. So walk
  // newest→oldest and feature the first set that actually has priced cards;
  // the new set takes over automatically once its prices land.
  const sortedSets = [...sets].sort(
    (a, b) => new Date(b.releaseDate).getTime() - new Date(a.releaseDate).getTime()
  );
  let newestSet: (typeof sortedSets)[number] | undefined;
  let newReleaseCards: Card[] = [];
  for (const set of sortedSets) {
    const cards = allCards
      .filter((c) => c.setId === set.id)
      .filter((c) => c.price?.marketPrice != null && c.price.marketPrice > 0)
      .sort((a, b) => (b.price?.marketPrice ?? 0) - (a.price?.marketPrice ?? 0))
      .slice(0, 15);
    if (cards.length > 0) {
      newestSet = set;
      newReleaseCards = cards;
      break;
    }
  }

  // 6 newest sets for Browse Sets section
  const newestSets = sortedSets.slice(0, 6);

  return (
    <div>
      {/* ===== LAUNCH RAFFLE (community event placeholder) ===== */}
      <LaunchRaffleBanner />

      {/* ===== RECENTLY VIEWED (returning users) ===== */}
      <RecentlyViewed />

      {/* ===== BEST DEALS (lead with savings) ===== */}
      {dealCards.length > 0 && (
        <section className="mb-12 sm:mb-16">
          <CardCarousel
            title="Today's Best Deals"
            subtitle="Cards with the biggest price drops this week"
            icon={
              <svg className="w-6 h-6 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
              </svg>
            }
            cards={dealCards}
            showPrice
            showPriceChange
            priceChanges={dealPriceChanges}
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
              <svg className="w-6 h-6 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            }
            cards={trendingCards}
            showPrice
            showPriceChange
            priceChanges={priceChanges}
            viewAllHref="/hot"
          />
        </section>
      )}

      {/* ===== JUST LISTED (renamed from New Lows) ===== */}
      {enrichedListings.length > 0 && (
        <section className="mb-12 sm:mb-16">
          <ListingCarousel
            title="Just Listed"
            subtitle="Fresh listings at the lowest active price — buy before someone else does"
            icon={
              <svg className="w-6 h-6 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
            }
            listings={enrichedListings}
          />
        </section>
      )}

      {/* ===== TOP OFFERS (buyer side — pairs with Just Listed) ===== */}
      {topOffers.length > 0 && (
        <section className="mb-12 sm:mb-16">
          <OfferCarousel
            title="Top Offers"
            subtitle="The highest open offers right now — own one of these? Sell instantly."
            icon={
              <svg className="w-6 h-6 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 010 1.954l-7.108 4.061A1.125 1.125 0 013 16.811V8.69zM12.75 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 010 1.954l-7.108 4.061a1.125 1.125 0 01-1.683-.977V8.69z" />
              </svg>
            }
            offers={topOffers}
          />
        </section>
      )}

      {/* ===== BROWSE SETS (promoted up + bigger tiles) ===== */}
      <section className="mb-12 sm:mb-16">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-xl font-bold text-zinc-900">Browse by Set</h2>
            <p className="text-sm text-zinc-500 mt-1">
              Newest releases — find what you&apos;re collecting
            </p>
          </div>
          <Link
            href="/sets"
            className="text-sm text-orange-600 hover:text-orange-700 transition-colors shrink-0"
          >
            View all {sets.length} sets &rarr;
          </Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {newestSets.map((set) => {
            const setImage = setImages[set.id];
            return (
              <Link
                key={set.id}
                href={`/${set.id}`}
                className="block bg-white rounded-xl border border-zinc-200 hover:border-zinc-400 hover:shadow-md transition-all group overflow-hidden"
              >
                {setImage?.boosterBoxImageUrl ? (
                  <div className="relative w-full aspect-square bg-gradient-to-br from-zinc-50 to-white">
                    <Image
                      src={setImage.boosterBoxImageUrl}
                      alt={`${set.name} Booster Box`}
                      fill
                      className="object-contain p-4 group-hover:scale-105 transition-transform duration-300"
                      unoptimized
                    />
                  </div>
                ) : (
                  <div className="relative w-full aspect-square bg-zinc-50 flex items-center justify-center text-zinc-300">
                    <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6z" />
                    </svg>
                  </div>
                )}
                <div className="p-4 border-t border-zinc-100">
                  <h3 className="font-semibold text-base text-zinc-900 group-hover:text-orange-600 transition-colors">
                    {set.id.toUpperCase()}
                  </h3>
                  <p className="text-zinc-500 text-xs mt-0.5 line-clamp-1">
                    {getSetShortName(set.name)}
                  </p>
                  <p className="text-zinc-400 text-[11px] mt-1 tabular-nums">
                    {set.cardCount} cards
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* ===== NEW RELEASES ===== */}
      {newReleaseCards.length > 0 && newestSet && (
        <section className="mb-12 sm:mb-16">
          <CardCarousel
            title={`New: ${getSetShortName(newestSet.name)}`}
            subtitle={`Top cards from the latest set, ${newestSet.id.toUpperCase()}`}
            icon={
              <svg className="w-6 h-6 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
              </svg>
            }
            cards={newReleaseCards}
            showPrice
            viewAllHref={`/${newestSet.id}`}
          />
        </section>
      )}

      {/* ===== MOST VALUABLE (demoted to aspirational eye-candy) ===== */}
      {mostValuable.length > 0 && (
        <section className="mb-12 sm:mb-16">
          <CardCarousel
            title="Grails"
            subtitle="The most valuable cards across every set"
            icon={
              <svg className="w-6 h-6 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
            cards={mostValuable}
            showPrice
            viewAllHref="/hot"
          />
        </section>
      )}

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
