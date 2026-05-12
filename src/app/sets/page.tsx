import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { getAllSets, getAllSetImages, getBrowsableCards } from "@/lib/cards";

export const metadata: Metadata = {
  title: "All Sets",
  description: "Browse every One Piece TCG set on Nomi market. Pick a set to see its cards, prices, and sale history.",
};

function getSetShortName(fullName: string): string {
  const match = fullName.match(/^[A-Z0-9-]+ - (.+)$/i);
  return match ? match[1] : fullName;
}

function formatPrice(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function SetsPage() {
  const sets = getAllSets();
  const setImages = getAllSetImages();
  const allCards = await getBrowsableCards();

  // Top 10 value per set (sum of top 10 cards in each set by market_price).
  const top10BySet = new Map<string, number>();
  const cardsBySet = new Map<string, number[]>();
  for (const c of allCards) {
    const p = c.price?.marketPrice;
    if (p == null || p <= 0) continue;
    const arr = cardsBySet.get(c.setId) ?? [];
    arr.push(p);
    cardsBySet.set(c.setId, arr);
  }
  for (const [setId, prices] of cardsBySet) {
    prices.sort((a, b) => b - a);
    top10BySet.set(setId, prices.slice(0, 10).reduce((s, p) => s + p, 0));
  }

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
          const top10 = top10BySet.get(set.id);
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
              <div className="p-3 text-center">
                {/* Set identity — secondary */}
                <h3 className="font-semibold text-sm text-zinc-900 group-hover:text-orange-500 transition-colors line-clamp-1">
                  {getSetShortName(set.name)}
                </h3>
                <p className="text-[11px] text-zinc-400 font-mono mt-0.5">
                  {set.id.toUpperCase()}
                </p>

                {/* Top 10 value — the standout */}
                {top10 != null && top10 > 0 && (
                  <div className="mt-2 pt-2 border-t border-zinc-100">
                    <p className="text-lg font-bold text-zinc-900 tabular-nums leading-none">
                      {formatPrice(top10)}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-zinc-400 mt-1">
                      Top 10 value
                    </p>
                  </div>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
