import Link from "next/link";

export function SellCTA() {
  return (
    <section className="mb-12 sm:mb-16">
      <div className="rounded-2xl bg-gradient-to-r from-orange-50 to-indigo-50 border border-orange-100 px-8 py-12 text-center">
        <h2 className="text-2xl sm:text-3xl font-bold text-zinc-900 mb-3">
          Have cards to sell?
        </h2>
        <p className="text-zinc-500 max-w-md mx-auto mb-6">
          List your cards on the marketplace. Every transaction authenticated
          and protected.
        </p>
        <Link
          href="/sell"
          className="inline-flex items-center gap-2 px-6 py-3 bg-orange-500 text-white font-medium rounded-lg hover:bg-orange-600 transition-colors"
        >
          Start Selling
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M17 8l4 4m0 0l-4 4m4-4H3"
            />
          </svg>
        </Link>
      </div>
    </section>
  );
}
