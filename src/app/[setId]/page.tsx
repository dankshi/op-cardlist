import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { getSetBySlug, getAllSets } from "@/lib/cards";
import CardGrid from "@/components/CardGrid";
import SetStats from "@/components/SetStats";
import { SITE_URL, SITE_NAME, getSetKeywords, getSetShortName, getBreadcrumbSchema } from "@/lib/seo";

interface PageProps {
  params: Promise<{ setId: string }>;
}

export async function generateStaticParams() {
  const sets = getAllSets();
  return sets.flatMap((set) => {
    const noHyphen = set.id.replace('-', '');
    const params = [{ setId: set.id }];
    // Also pre-render no-hyphen variants (e.g. "eb03") so they redirect
    if (noHyphen !== set.id) {
      params.push({ setId: noHyphen });
    }
    return params;
  });
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { setId } = await params;
  const set = await getSetBySlug(setId);

  if (!set) {
    return {
      title: "Set Not Found",
    };
  }

  const setUpper = set.id.toUpperCase();
  const setNoHyphen = set.id.replace('-', '').toUpperCase();
  const shortName = getSetShortName(set.name);
  const pageUrl = `${SITE_URL}/${set.id}`;

  // Get first card with an image for OG
  const firstCard = set.cards[0];
  const ogImage = firstCard?.imageUrl;

  // Find chase card for description
  const chaseCard = [...set.cards]
    .filter((c) => c.price?.marketPrice != null)
    .sort((a, b) => (b.price?.marketPrice ?? 0) - (a.price?.marketPrice ?? 0))[0];
  const chaseSuffix = chaseCard?.price?.marketPrice
    ? ` Most expensive: ${chaseCard.name} at $${chaseCard.price.marketPrice.toFixed(2)}.`
    : '';

  return {
    title: `${setUpper} (${setNoHyphen}) ${shortName} Card List & Price Guide - ${set.cardCount} Cards`,
    description: `Complete ${setNoHyphen} / ${setUpper} ${shortName} card list and price guide for One Piece TCG. Browse all ${set.cardCount} ${setNoHyphen} cards with images, prices, and effects.${chaseSuffix} Updated daily.`,
    keywords: getSetKeywords(set.id, set.name),
    openGraph: {
      title: `${setUpper} ${shortName} Card List - ${set.cardCount} Cards | One Piece TCG`,
      description: `Browse all ${set.cardCount} cards from ${shortName}. Complete ${setUpper} spoilers, card images, and TCGPlayer prices.`,
      url: pageUrl,
      siteName: SITE_NAME,
      type: "website",
      ...(ogImage && {
        images: [
          {
            url: ogImage,
            width: 245,
            height: 342,
            alt: `${setUpper} Card List - One Piece TCG`,
          },
        ],
      }),
    },
    twitter: {
      card: "summary_large_image",
      title: `${setUpper} ${shortName} Card List - ${set.cardCount} Cards`,
      description: `Complete ${setUpper} ${shortName} card list and price guide for One Piece TCG. ${set.cardCount} cards with prices.`,
      ...(ogImage && { images: [ogImage] }),
    },
    alternates: {
      canonical: pageUrl,
    },
  };
}

export default async function SetPage({ params }: PageProps) {
  const { setId } = await params;
  const set = await getSetBySlug(setId);

  if (!set) {
    notFound();
  }

  // Redirect non-canonical URLs (e.g. /prb01 → /prb-01, /EB-03 → /eb-03)
  if (setId !== set.id) {
    redirect(`/${set.id}`);
  }

  const shortName = getSetShortName(set.name);

  // Count card types
  const leaders = set.cards.filter((c) => c.type === "LEADER").length;
  const characters = set.cards.filter((c) => c.type === "CHARACTER").length;
  const events = set.cards.filter((c) => c.type === "EVENT").length;
  const stages = set.cards.filter((c) => c.type === "STAGE").length;

  return (
    <div>
      {/* Breadcrumb */}
      <nav className="text-sm text-zinc-500 mb-6">
        <Link href="/" className="hover:text-white light:hover:text-zinc-900 transition-colors">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-white light:text-zinc-900">{set.id.toUpperCase()}</span>
      </nav>

      {/* Header */}
      <header className="mb-8">
        <h1 className="text-3xl font-bold mb-2">{set.id.toUpperCase()} ({set.id.replace('-', '').toUpperCase()}) {shortName} Card List</h1>
        <div className="flex items-center gap-3 mb-4">
          <p className="text-zinc-400 light:text-zinc-600">{set.name}</p>
          <span className="text-xs text-zinc-600 light:text-zinc-400">·</span>
          <p className="text-xs text-zinc-600 light:text-zinc-400">
            Prices updated {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>
        </div>

        {/* Quick Stats */}
        <div className="flex flex-wrap gap-4 text-sm">
          <span className="px-3 py-1 bg-zinc-800 light:bg-zinc-100 rounded-full">
            {set.cardCount} cards
          </span>
          {leaders > 0 && (
            <span className="px-3 py-1 bg-zinc-800 light:bg-zinc-100 rounded-full">
              {leaders} Leaders
            </span>
          )}
          {characters > 0 && (
            <span className="px-3 py-1 bg-zinc-800 light:bg-zinc-100 rounded-full">
              {characters} Characters
            </span>
          )}
          {events > 0 && (
            <span className="px-3 py-1 bg-zinc-800 light:bg-zinc-100 rounded-full">
              {events} Events
            </span>
          )}
          {stages > 0 && (
            <span className="px-3 py-1 bg-zinc-800 light:bg-zinc-100 rounded-full">
              {stages} Stages
            </span>
          )}
        </div>
      </header>

      {/* Set Value Metrics */}
      <SetStats cards={set.cards} setId={set.id} />

      {/* Most Valuable Cards - SEO content for price-related searches */}
      {(() => {
        const topCards = set.cards
          .filter((c) => c.price?.marketPrice != null && c.price.marketPrice > 0)
          .sort((a, b) => (b.price?.marketPrice ?? 0) - (a.price?.marketPrice ?? 0))
          .slice(0, 10);
        if (topCards.length === 0) return null;
        const setUpper = set.id.toUpperCase();
        const setNoHyphen = set.id.replace('-', '').toUpperCase();
        return (
          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">
              Most Valuable {setUpper} ({setNoHyphen}) Cards
            </h2>
            <div className="grid gap-2">
              {topCards.map((card, i) => (
                <Link
                  key={card.id}
                  href={`/card/${card.id.toLowerCase()}`}
                  className="flex items-center gap-3 px-4 py-3 bg-zinc-800/50 light:bg-zinc-100 border border-zinc-700/50 light:border-zinc-200 rounded-lg hover:border-zinc-600 light:hover:border-zinc-300 transition-colors"
                >
                  <span className="text-zinc-500 font-mono text-sm w-6 text-right shrink-0">
                    {i + 1}.
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="font-medium truncate block">{card.name}</span>
                    <span className="text-xs text-zinc-500">{card.id} · {card.rarity} · {card.type}</span>
                  </span>
                  <span className="text-green-400 font-bold shrink-0">
                    ${card.price!.marketPrice!.toFixed(2)}
                  </span>
                </Link>
              ))}
            </div>
            <p className="text-xs text-zinc-500 mt-3">
              Prices updated daily from TCGPlayer. The most expensive {setNoHyphen} card is {topCards[0].name} at ${topCards[0].price!.marketPrice!.toFixed(2)}.
            </p>
          </section>
        );
      })()}

      {/* Card Grid with Filters */}
      <h2 className="text-xl font-bold mb-4">All {set.id.toUpperCase()} Cards</h2>
      <CardGrid cards={set.cards} setId={set.id} />

      {/* BreadcrumbList Schema */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(getBreadcrumbSchema([
            { name: "Home", url: SITE_URL },
            { name: `${set.id.toUpperCase()} Card List`, url: `${SITE_URL}/${set.id}` },
          ])),
        }}
      />

      {/* ItemList Schema - Enhanced with more cards */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: `${set.id.toUpperCase()} Card List - One Piece TCG`,
            description: `Complete card list of all ${set.cardCount} cards from ${set.name} (${set.id.toUpperCase()}) for One Piece Trading Card Game`,
            numberOfItems: set.cardCount,
            itemListElement: set.cards
              .filter((card) => card.price?.marketPrice != null)
              .slice(0, 50)
              .map((card, index) => ({
              "@type": "ListItem",
              position: index + 1,
              url: `${SITE_URL}/card/${card.id.toLowerCase()}`,
              item: {
                "@type": "Product",
                name: card.name,
                description: card.effect || `${card.name} from ${set.id.toUpperCase()}`,
                image: card.imageUrl,
                sku: card.id,
                brand: {
                  "@type": "Brand",
                  name: "One Piece TCG",
                },
                offers: {
                  "@type": "Offer",
                  price: card.price!.marketPrice,
                  priceCurrency: "USD",
                  availability: "https://schema.org/InStock",
                  url: card.price!.tcgplayerUrl,
                },
              },
            })),
          }),
        }}
      />
    </div>
  );
}
