import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { getSetBySlug, getAllSets } from "@/lib/cards";
import CardGrid from "@/components/CardGrid";

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

  const setName = set.id.toUpperCase();

  return {
    title: `${setName} Card List - All ${set.cardCount} Cards`,
    description: `Complete ${setName} card list for One Piece TCG. Browse all ${set.cardCount} cards from ${set.name} with images, stats, and effects.`,
    keywords: [setName, "One Piece TCG", "card list", "spoilers", set.name],
    openGraph: {
      title: `${setName} Card List - One Piece TCG`,
      description: `All ${set.cardCount} cards from ${set.name}`,
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

      {/* JSON-LD Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: `${set.id.toUpperCase()} Card List`,
            description: `All ${set.cardCount} cards from ${set.name}`,
            numberOfItems: set.cardCount,
            itemListElement: set.cards.slice(0, 10).map((card, index) => ({
              "@type": "ListItem",
              position: index + 1,
              item: {
                "@type": "Product",
                name: card.name,
                description: card.effect,
                image: card.imageUrl,
                sku: card.id,
              },
            })),
          }),
        }}
      />
    </div>
  );
}
