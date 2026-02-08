import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { getSetBySlug, getAllSets } from "@/lib/cards";
import CardGrid from "@/components/CardGrid";
import { SITE_URL, SITE_NAME, getSetKeywords, getBreadcrumbSchema } from "@/lib/seo";

interface PageProps {
  params: Promise<{ setId: string }>;
}

export async function generateStaticParams() {
  const sets = getAllSets();
  return sets.map((set) => ({
    setId: set.id,
  }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { setId } = await params;
  const set = getSetBySlug(setId);

  if (!set) {
    return {
      title: "Set Not Found",
    };
  }

  const setUpper = set.id.toUpperCase();
  const setNoHyphen = set.id.replace('-', '').toUpperCase();
  const pageUrl = `${SITE_URL}/${set.id}`;

  // Get first card with an image for OG
  const firstCard = set.cards[0];
  const ogImage = firstCard?.imageUrl;

  return {
    title: `${setUpper} Card List - All ${set.cardCount} Cards with Prices`,
    description: `Complete ${setUpper} (${setNoHyphen}) card list for One Piece TCG. Browse all ${set.cardCount} cards from ${set.name} with images, prices, stats, and effects. Updated daily.`,
    keywords: getSetKeywords(set.id, set.name),
    openGraph: {
      title: `${setUpper} Card List - ${set.cardCount} Cards | One Piece TCG`,
      description: `Browse all ${set.cardCount} cards from ${set.name}. Complete ${setUpper} spoilers, card images, and TCGPlayer prices.`,
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
      title: `${setUpper} Card List - ${set.cardCount} Cards`,
      description: `Complete ${setUpper} card list for One Piece TCG. ${set.cardCount} cards with prices.`,
      ...(ogImage && { images: [ogImage] }),
    },
    alternates: {
      canonical: pageUrl,
    },
  };
}

export default async function SetPage({ params }: PageProps) {
  const { setId } = await params;
  const set = getSetBySlug(setId);

  if (!set) {
    notFound();
  }

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
        <h1 className="text-3xl font-bold mb-2">{set.id.toUpperCase()} Card List</h1>
        <p className="text-zinc-400 light:text-zinc-600 mb-4">{set.name}</p>

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

      {/* Card Grid with Filters */}
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
            itemListElement: set.cards.slice(0, 50).map((card, index) => ({
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
                ...(card.price?.marketPrice != null && {
                  offers: {
                    "@type": "Offer",
                    price: card.price.marketPrice,
                    priceCurrency: "USD",
                    availability: "https://schema.org/InStock",
                    url: card.price.tcgplayerUrl,
                  },
                }),
              },
            })),
          }),
        }}
      />
    </div>
  );
}
