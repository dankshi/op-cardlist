import type { Metadata } from "next";
import Link from "next/link";
import { searchCards, getAllCards } from "@/lib/cards";
import CardGrid from "@/components/CardGrid";

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export async function generateMetadata({
  searchParams,
}: PageProps): Promise<Metadata> {
  const { q } = await searchParams;
  return {
    title: q
      ? `Search: "${q}" | One Piece TCG`
      : "Search Cards | One Piece TCG",
    description: q
      ? `Search results for "${q}" in the One Piece TCG card database.`
      : "Search the complete One Piece TCG card database.",
    robots: { index: false, follow: true },
  };
}

export default async function SearchPage({ searchParams }: PageProps) {
  const { q } = await searchParams;
  const cards = q ? await searchCards(q) : await getAllCards();

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

      <CardGrid cards={cards} setId="search" />
    </div>
  );
}
