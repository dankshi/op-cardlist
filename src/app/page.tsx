import Link from "next/link";
import type { Metadata } from "next";
import { getAllSets, getLastUpdated } from "@/lib/cards";
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION, BASE_KEYWORDS } from "@/lib/seo";

export const metadata: Metadata = {
  title: "One Piece TCG Card List - Complete Database with Prices | All Sets",
  description: `${SITE_DESCRIPTION} Browse OP-13, EB-03, and all One Piece TCG sets with TCGPlayer market prices.`,
  keywords: [...BASE_KEYWORDS, "all sets", "complete database", "OP-13", "EB-03", "price guide"],
  alternates: {
    canonical: SITE_URL,
  },
};

export default function Home() {
  const sets = getAllSets().sort((a, b) => b.id.localeCompare(a.id));
  const lastUpdated = getLastUpdated();
  const totalCards = sets.reduce((sum, set) => sum + set.cardCount, 0);

  return (
    <div>
      {/* Construction Banner */}
      <div className="mb-8 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
        <p className="text-amber-500 text-center">
          <span className="font-semibold">Under Construction</span> — We're still building things out, so you may encounter some errors. Feel free to take a look around!
        </p>
      </div>

      <section className="mb-12">
        <h1 className="text-4xl font-bold mb-4">One Piece TCG Card List</h1>
        <p className="text-zinc-400 light:text-zinc-600 text-lg mb-6">
          Browse {totalCards.toLocaleString()} cards across {sets.length} set{sets.length !== 1 ? 's' : ''}.
          Fast, mobile-friendly, and always up-to-date.
        </p>
        <div className="flex gap-4 text-sm text-zinc-500">
          <span>Last updated: {new Date(lastUpdated).toLocaleDateString()}</span>
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-semibold mb-6">All Sets</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sets.map((set) => (
            <Link
              key={set.id}
              href={`/${set.id}`}
              className="block p-6 bg-zinc-900 light:bg-white rounded-lg border border-zinc-800 light:border-zinc-200 hover:border-zinc-700 light:hover:border-zinc-300 hover:bg-zinc-800/50 light:hover:bg-zinc-50 transition-all group"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-lg group-hover:text-red-400 transition-colors">
                    {set.id.toUpperCase()}
                  </h3>
                  <p className="text-zinc-400 light:text-zinc-600 text-sm mt-1 line-clamp-2">
                    {set.name}
                  </p>
                </div>
                <span className="text-zinc-500 text-sm bg-zinc-800 light:bg-zinc-100 px-2 py-1 rounded">
                  {set.cardCount} cards
                </span>
              </div>
            </Link>
          ))}
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
