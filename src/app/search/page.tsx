import type { Metadata } from "next";
import Link from "next/link";
import { searchCards, searchSets, getAllCards } from "@/lib/cards";
import CardGrid from "@/components/CardGrid";

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export async function generateMetadata({
  searchParams,
}: PageProps): Promise<Metadata> {
  const { q } = await searchParams;
  // Index search pages that have a specific query with results (but not overly broad ones)
  let shouldIndex = false;
  if (q && q.length >= 3) {
    const results = await searchCards(q);
    shouldIndex = results.length > 0 && results.length < 200;
  }
  return {
    title: q
      ? `${q} - One Piece TCG Cards`
      : "Search Cards | One Piece TCG",
    description: q
      ? `Find One Piece TCG cards matching "${q}". Browse card images, effects, prices, and stats.`
      : "Search the complete One Piece TCG card database.",
    robots: shouldIndex ? { index: true, follow: true } : { index: false, follow: true },
  };
}

export default async function SearchPage({ searchParams }: PageProps) {
  const { q } = await searchParams;
  const cards = q ? await searchCards(q) : await getAllCards();
  const matchedSets = q ? searchSets(q) : [];

  return (
    <div>
      <nav className="text-sm text-zinc-500 mb-6">
        <Link
          href="/"
          className="hover:text-white light:hover:text-zinc-900 transition-colors"
        >
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-white light:text-zinc-900">Search</span>
      </nav>

      <header className="mb-8">
        <h1 className="text-3xl font-bold mb-2">
          {q ? <>Results for &ldquo;{q}&rdquo;</> : "Search All Cards"}
        </h1>
        <p className="text-zinc-400 light:text-zinc-600">
          {cards.length} card{cards.length !== 1 ? "s" : ""} found
        </p>
      </header>

      {/* Set matches banner */}
      {matchedSets.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-3">
          {matchedSets.map(set => (
            <Link
              key={set.id}
              href={`/${set.id}`}
              className="flex items-center gap-3 px-4 py-3 bg-sky-500/10 border border-sky-500/20 rounded-lg hover:bg-sky-500/20 transition-colors"
            >
              <svg className="w-5 h-5 text-sky-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <div>
                <p className="font-medium text-sm">{set.id.toUpperCase()} {set.shortName}</p>
                <p className="text-xs text-zinc-500">{set.cardCount} cards &middot; View full set</p>
              </div>
            </Link>
          ))}
        </div>
      )}

      <CardGrid cards={cards} setId="search" />
    </div>
  );
}
