import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { getAllSets, getAllSetImages } from "@/lib/cards";

export const metadata: Metadata = {
  title: "All Sets",
  description: "Browse every One Piece TCG set on Nomi market. Pick a set to see its cards, prices, and sale history.",
};

function getSetShortName(fullName: string): string {
  const match = fullName.match(/^[A-Z0-9-]+ - (.+)$/i);
  return match ? match[1] : fullName;
}

export default function SetsPage() {
  const sets = getAllSets();
  const setImages = getAllSetImages();

  // Newest releases first
  const sortedSets = [...sets].sort(
    (a, b) => new Date(b.releaseDate).getTime() - new Date(a.releaseDate).getTime(),
  );

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-zinc-900">All Sets</h1>
        <p className="text-sm text-zinc-500 mt-2">
          {sets.length} sets · pick one to browse its cards.
        </p>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4">
        {sortedSets.map((set) => {
          const setImage = setImages[set.id];
          return (
            <Link
              key={set.id}
              href={`/${set.id}`}
              className="block bg-white rounded-lg border border-zinc-200 hover:border-zinc-300 hover:shadow-sm transition-all group overflow-hidden"
            >
              {setImage?.boosterBoxImageUrl && (
                <div className="relative w-full aspect-square bg-white">
                  <Image
                    src={setImage.boosterBoxImageUrl}
                    alt={`${set.name} Booster Box`}
                    fill
                    className="object-contain p-2 group-hover:scale-105 transition-transform duration-300"
                    unoptimized
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
                <p className="text-zinc-400 text-[11px] mt-0.5">
                  {set.cardCount} cards
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
