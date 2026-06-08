"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { Card, Rarity } from "@/types/card";
import type { ListingsSummary } from "@/lib/cards";
import { CardThumbnail } from "./card/CardThumbnail";
import { PriceRow, ViewPill } from "./card/PriceRow";

function formatUSD(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ListingsLine({ summary }: { summary: ListingsSummary }) {
  const noun = summary.count === 1 ? 'listing' : 'listings';
  return (
    <div className="text-xs">
      <span className="text-zinc-500">{summary.count} {noun} from </span>
      <span className="font-semibold tabular-nums text-zinc-900">
        ${formatUSD(summary.lowestPrice)}
      </span>
    </div>
  );
}

/** GRAIL: SPs, TRs, and manga-art alts — the chase pulls. Used as a plain
 *  filter facet (narrows the grid like rarity), not a themed view. */
function isGrailCard(card: Card): boolean {
  return card.rarity === 'SP' || card.rarity === 'TR' || card.artStyle === 'manga';
}

interface CardGridProps {
  cards: Card[];
  setId: string;
  initialSearch?: string;
  priceChanges?: Record<string, number>;
  /** card_id → { count, lowestPrice } for active on-site listings.
   *  Missing key = no sellers (tile shows only market price). */
  listingsSummary?: Record<string, ListingsSummary>;
}

const RARITIES: Rarity[] = ["L", "SEC", "SP", "SR", "R"];

type SortOption = 'price-desc' | 'name-asc' | 'id-asc';

const SORT_LABELS: Record<SortOption, string> = {
  'price-desc': 'Price: High to low',
  'name-asc': 'Name: A–Z',
  'id-asc': 'Card number',
};

export default function CardGrid({ cards, initialSearch, priceChanges, listingsSummary }: CardGridProps) {
  const [searchQuery, setSearchQuery] = useState(initialSearch ?? "");
  const [selectedRarities, setSelectedRarities] = useState<Rarity[]>([]);
  // Grail = chase-card filter (SP / TR / manga alt). A plain stackable facet
  // now — it just narrows the grid like rarity, no dark theme or takeover.
  const [grailOnly, setGrailOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('price-desc');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // Only offer the grail filter when the set actually has chase cards.
  const hasGrailCards = useMemo(() => cards.some(isGrailCard), [cards]);

  const filteredCards = useMemo(() => {
    let searchTokens: string[] = [];
    if (searchQuery.trim()) {
      const noiseWords = new Set(['one', 'piece', 'card', 'tcg', 'the', 'a', 'of', 'and', 'in', 'from']);
      const tokens = searchQuery.trim().toLowerCase().split(/\s+/).filter(t => t.length > 0);
      const meaningful = tokens.filter(t => !noiseWords.has(t));
      searchTokens = meaningful.length > 0 ? meaningful : tokens;
    }

    const filtered = cards.filter((card) => {
      // Tokenized search filter — every token must match at least one field
      if (searchTokens.length > 0) {
        const nameLower = card.name.toLowerCase();
        const idLower = card.id.toLowerCase();
        const effectLower = card.effect.toLowerCase();
        const traitsLower = card.traits.join(' ').toLowerCase();
        const typeLower = card.type.toLowerCase();

        const allMatch = searchTokens.every(token =>
          nameLower.includes(token) ||
          idLower.includes(token) ||
          traitsLower.includes(token) ||
          effectLower.includes(token) ||
          typeLower.includes(token)
        );
        if (!allMatch) return false;
      }

      // Rarity filter
      if (selectedRarities.length > 0 && !selectedRarities.includes(card.rarity)) {
        return false;
      }

      // Grail filter
      if (grailOnly && !isGrailCard(card)) {
        return false;
      }

      return true;
    });

    // Sort the filtered cards
    return filtered.sort((a, b) => {
      switch (sortBy) {
        case 'price-desc': {
          const priceA = a.price?.marketPrice ?? 0;
          const priceB = b.price?.marketPrice ?? 0;
          return priceB - priceA;
        }
        case 'name-asc':
          return a.name.localeCompare(b.name);
        case 'id-asc':
          return a.id.localeCompare(b.id);
        default:
          return 0;
      }
    });
  }, [cards, searchQuery, selectedRarities, grailOnly, sortBy]);

  const toggleRarity = (r: Rarity) => {
    setSelectedRarities((prev) =>
      prev.includes(r) ? prev.filter((v) => v !== r) : [...prev, r]
    );
  };

  const clearFilters = () => {
    setSearchQuery("");
    setSelectedRarities([]);
    setGrailOnly(false);
    setSortBy('price-desc');
  };

  const activeFilterCount = selectedRarities.length + (grailOnly ? 1 : 0);
  const hasActiveFilters = Boolean(searchQuery) || activeFilterCount > 0;

  return (
    <div>
      {/* Search bar */}
      <div className="relative mb-6">
        <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
        </svg>
        <input
          type="text"
          placeholder="Search cards by name, effect, or trait…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-11 pr-10 py-3 bg-white border border-zinc-200 rounded-lg text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900/5 transition-all"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 inline-flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
          >
            &times;
          </button>
        )}
      </div>

      {/* Sidebar + Grid */}
      <div className="flex gap-8">
        {/* Desktop sidebar */}
        <aside className="hidden md:block w-56 shrink-0">
          <FilterPanel
            selectedRarities={selectedRarities}
            onToggleRarity={toggleRarity}
            grailOnly={grailOnly}
            onToggleGrail={() => setGrailOnly((v) => !v)}
            showGrail={hasGrailCards}
            onClear={clearFilters}
            hasActiveFilters={hasActiveFilters}
          />
        </aside>

        {/* Main column */}
        <div className="flex-1 min-w-0">
          {/* Results header — count on the left, sort on the right. */}
          <div className="flex items-center justify-between gap-3 mb-4 pb-4 border-b border-zinc-200">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(true)}
                className="md:hidden inline-flex items-center gap-2 px-3 py-2 rounded-md border border-zinc-200 bg-white text-sm font-medium text-zinc-900 hover:border-zinc-400 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 5h18M6 12h12M10 19h4" />
                </svg>
                Filters
                {activeFilterCount > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-zinc-900 text-white text-[11px] font-semibold">
                    {activeFilterCount}
                  </span>
                )}
              </button>
              <p className="text-sm truncate text-zinc-500">
                <span className="font-medium tabular-nums text-zinc-900">
                  {filteredCards.length}
                </span>{' '}
                of <span className="tabular-nums">{cards.length}</span> cards
              </p>
            </div>

            {/* Sort dropdown */}
            <div className="flex items-center gap-2 shrink-0">
              <label htmlFor="sort-select" className="hidden sm:block text-xs uppercase tracking-wider text-zinc-500 font-medium">
                Sort
              </label>
              <div className="relative">
                <select
                  id="sort-select"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="appearance-none pl-3 pr-8 py-2 rounded-md border border-zinc-200 bg-white text-sm font-medium text-zinc-900 hover:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/5 transition-colors cursor-pointer"
                >
                  {(Object.keys(SORT_LABELS) as SortOption[]).map((opt) => (
                    <option key={opt} value={opt}>{SORT_LABELS[opt]}</option>
                  ))}
                </select>
                <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>

          {/* Card Grid */}
          <div className="grid gap-x-4 gap-y-6 grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {filteredCards.map((card) => {
              const summary = listingsSummary?.[card.id];
              return (
                <Link
                  key={card.id}
                  href={`/card/${card.id.toLowerCase()}`}
                  className="block group"
                >
                  <CardThumbnail card={card} />
                  {card.price?.marketPrice != null && (
                    <PriceRow
                      price={card.price.marketPrice}
                      changePercent={priceChanges?.[card.id] ?? null}
                      trailing={<ViewPill />}
                    />
                  )}
                  {summary && (
                    <div className={card.price?.marketPrice != null ? 'mt-1' : 'mt-2'}>
                      <ListingsLine summary={summary} />
                    </div>
                  )}
                </Link>
              );
            })}
          </div>

          {filteredCards.length === 0 && (
            <div className="text-center py-16 text-zinc-500">
              <p>No cards found matching your filters.</p>
              <button
                onClick={clearFilters}
                className="mt-2 text-orange-600 hover:text-orange-700 transition-colors"
              >
                Clear all filters
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile filter bottom-sheet */}
      {mobileFiltersOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-zinc-900/50"
            onClick={() => setMobileFiltersOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] bg-white rounded-t-2xl shadow-xl flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-zinc-200">
              <h3 className="text-base font-semibold text-zinc-900">Filters</h3>
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                aria-label="Close filters"
                className="w-8 h-8 inline-flex items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100"
              >
                &times;
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <FilterPanel
                selectedRarities={selectedRarities}
                onToggleRarity={toggleRarity}
                grailOnly={grailOnly}
                onToggleGrail={() => setGrailOnly((v) => !v)}
                showGrail={hasGrailCards}
                onClear={clearFilters}
                hasActiveFilters={hasActiveFilters}
              />
            </div>
            <div className="p-4 border-t border-zinc-200 bg-zinc-50">
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                className="w-full py-3 rounded-md bg-zinc-900 text-white font-semibold text-sm hover:bg-zinc-800 transition-colors"
              >
                Show {filteredCards.length} {filteredCards.length === 1 ? 'card' : 'cards'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterPanel({
  selectedRarities,
  onToggleRarity,
  grailOnly,
  onToggleGrail,
  showGrail,
  onClear,
  hasActiveFilters,
}: {
  selectedRarities: Rarity[];
  onToggleRarity: (r: Rarity) => void;
  grailOnly: boolean;
  onToggleGrail: () => void;
  showGrail: boolean;
  onClear: () => void;
  hasActiveFilters: boolean;
}) {
  return (
    <div className="space-y-6">
      <section>
        <h4 className="text-[11px] uppercase tracking-[0.14em] text-zinc-500 font-semibold mb-3">
          Rarity
        </h4>
        <div className="grid grid-cols-2 gap-2">
          {RARITIES.map((rarity) => {
            const checked = selectedRarities.includes(rarity);
            return (
              <button
                key={rarity}
                type="button"
                onClick={() => onToggleRarity(rarity)}
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  checked
                    ? 'bg-zinc-900 text-white'
                    : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:ring-zinc-400'
                }`}
              >
                {rarity}
              </button>
            );
          })}
        </div>

        {/* Grail — a plain filter sitting directly under the rarity chips. */}
        {showGrail && (
          <button
            type="button"
            onClick={onToggleGrail}
            aria-pressed={grailOnly}
            title="Show only the chase cards (SP / TR / manga alts)"
            className={`mt-2 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              grailOnly
                ? 'bg-zinc-900 text-amber-300'
                : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:ring-zinc-400'
            }`}
          >
            <svg className="w-3.5 h-3.5 text-amber-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.539 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            Grail
          </button>
        )}
      </section>

      {hasActiveFilters && (
        <>
          <div className="border-t border-zinc-200" />
          <button
            type="button"
            onClick={onClear}
            className="text-sm text-zinc-500 hover:text-zinc-900 transition-colors"
          >
            Clear all filters
          </button>
        </>
      )}
    </div>
  );
}
