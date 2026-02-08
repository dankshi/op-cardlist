import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { getAllSets, getLastUpdated, getAllSetImages } from "@/lib/cards";
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
  // Sort by release date (newest first), already sorted in cards.json
  const sets = getAllSets();
  const lastUpdated = getLastUpdated();
  const totalCards = sets.reduce((sum, set) => sum + set.cardCount, 0);
  const setImages = getAllSetImages();

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
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {sets.map((set) => {
            const setImage = setImages[set.id];
            return (
              <Link
                key={set.id}
                href={`/${set.id}`}
                className="block bg-zinc-900 light:bg-white rounded-lg border border-zinc-800 light:border-zinc-200 hover:border-zinc-700 light:hover:border-zinc-300 hover:bg-zinc-800/50 light:hover:bg-zinc-50 transition-all group overflow-hidden"
              >
                {setImage?.boosterBoxImageUrl && (
                  <div className="relative w-full aspect-[4/3] bg-white">
                    <img
                      src={setImage.boosterBoxImageUrl}
                      alt={`${set.name} Booster Box`}
                      className="w-full h-full object-contain p-2 group-hover:scale-105 transition-transform duration-300"
                    />
                  </div>
                )}
                <div className="p-3">
                  <h3 className="font-semibold text-sm group-hover:text-red-400 transition-colors">
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
