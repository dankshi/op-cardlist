"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { Card, CardColor, CardType, Rarity } from "@/types/card";
import { CardThumbnail } from "./card/CardThumbnail";

interface CardGridProps {
  cards: Card[];
  setId: string;
}

const COLORS: CardColor[] = ["Red", "Green", "Blue", "Purple", "Black", "Yellow"];
const TYPES: CardType[] = ["LEADER", "CHARACTER", "EVENT", "STAGE"];
const RARITIES: Rarity[] = ["L", "SEC", "SP", "SR", "R", "UC", "C"];

// Selected state colors for card color filters
const colorClassesSelected: Record<CardColor, string> = {
  Red: "bg-red-600 text-white border-red-600",
  Green: "bg-green-600 text-white border-green-600",
  Blue: "bg-blue-600 text-white border-blue-600",
  Purple: "bg-purple-600 text-white border-purple-600",
  Black: "bg-zinc-600 text-white border-zinc-600",
  Yellow: "bg-yellow-500 text-black border-yellow-500",
};

// Standard selected state for most filters
const selectedClass = "bg-blue-600 text-white border-blue-600";
const unselectedClass = "bg-zinc-800 dark:bg-zinc-800 light:bg-zinc-100 text-zinc-400 dark:text-zinc-400 light:text-zinc-600 border-zinc-700 dark:border-zinc-700 light:border-zinc-300 hover:border-zinc-500 dark:hover:border-zinc-500 light:hover:border-zinc-400";

type SortOption = 'price-desc' | 'name-asc' | 'id-asc';

export default function CardGrid({ cards, setId }: CardGridProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedColors, setSelectedColors] = useState<CardColor[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<CardType[]>([]);
  const [selectedRarities, setSelectedRarities] = useState<Rarity[]>([]);
  const [artFilter, setArtFilter] = useState<'all' | 'base' | 'parallels'>('all');
  const [sortBy, setSortBy] = useState<SortOption>('price-desc');

  const filteredCards = useMemo(() => {
    const filtered = cards.filter((card) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          card.name.toLowerCase().includes(query) ||
          card.effect.toLowerCase().includes(query) ||
          card.id.toLowerCase().includes(query) ||
          card.traits.some((t) => t.toLowerCase().includes(query));
        if (!matchesSearch) return false;
      }

      // Color filter
      if (selectedColors.length > 0) {
        const hasSelectedColor = card.colors.some((c) => selectedColors.includes(c));
        if (!hasSelectedColor) return false;
      }

      // Type filter
      if (selectedTypes.length > 0 && !selectedTypes.includes(card.type)) {
        return false;
      }

      // Rarity filter
      if (selectedRarities.length > 0 && !selectedRarities.includes(card.rarity)) {
        return false;
      }

      // Art filter (all/base/parallels)
      if (artFilter === 'base' && card.isParallel) {
        return false;
      }
      if (artFilter === 'parallels' && !card.isParallel) {
        return false;
      }

      return true;
    });

    // Sort the filtered cards
    return filtered.sort((a, b) => {
      switch (sortBy) {
        case 'price-desc':
          const priceA = a.price?.marketPrice ?? 0;
          const priceB = b.price?.marketPrice ?? 0;
          return priceB - priceA;
        case 'name-asc':
          return a.name.localeCompare(b.name);
        case 'id-asc':
          return a.id.localeCompare(b.id);
        default:
          return 0;
      }
    });
  }, [cards, searchQuery, selectedColors, selectedTypes, selectedRarities, artFilter, sortBy]);

  const toggleFilter = <T,>(
    value: T,
    selected: T[],
    setSelected: React.Dispatch<React.SetStateAction<T[]>>
  ) => {
    setSelected((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  };

  const clearFilters = () => {
    setSearchQuery("");
    setSelectedColors([]);
    setSelectedTypes([]);
    setSelectedRarities([]);
    setArtFilter('all');
    setSortBy('price-desc');
  };

  const hasActiveFilters =
    searchQuery || selectedColors.length > 0 || selectedTypes.length > 0 || selectedRarities.length > 0 || artFilter !== 'all';

  return (
    <div>
      {/* Search and Filters */}
      <div className="mb-8 space-y-4">
        {/* Search */}
        <div className="relative">
          <input
            type="text"
            placeholder="Search cards by name, effect, or trait..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-3 bg-zinc-900 dark:bg-zinc-900 light:bg-white border border-zinc-800 dark:border-zinc-800 light:border-zinc-300 rounded-lg text-white dark:text-white light:text-zinc-900 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600 dark:focus:border-zinc-600 light:focus:border-zinc-400 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white dark:hover:text-white light:hover:text-zinc-900"
            >
              &times;
            </button>
          )}
        </div>

        {/* Filter Groups */}
        <div className="flex flex-wrap gap-6">
          {/* Color Filters */}
          <div>
            <h4 className="text-xs font-medium text-zinc-500 uppercase mb-2">Color</h4>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => toggleFilter(color, selectedColors, setSelectedColors)}
                  className={`px-3 py-1 text-sm rounded border transition-all ${
                    selectedColors.includes(color)
                      ? colorClassesSelected[color]
                      : unselectedClass
                  }`}
                >
                  {color}
                </button>
              ))}
            </div>
          </div>

          {/* Type Filters */}
          <div>
            <h4 className="text-xs font-medium text-zinc-500 uppercase mb-2">Type</h4>
            <div className="flex flex-wrap gap-2">
              {TYPES.map((type) => (
                <button
                  key={type}
                  onClick={() => toggleFilter(type, selectedTypes, setSelectedTypes)}
                  className={`px-3 py-1 text-sm rounded border transition-all ${
                    selectedTypes.includes(type)
                      ? selectedClass
                      : unselectedClass
                  }`}
                >
                  {type.charAt(0) + type.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Rarity Filters */}
          <div>
            <h4 className="text-xs font-medium text-zinc-500 uppercase mb-2">Rarity</h4>
            <div className="flex flex-wrap gap-2">
              {RARITIES.map((rarity) => (
                <button
                  key={rarity}
                  onClick={() => toggleFilter(rarity, selectedRarities, setSelectedRarities)}
                  className={`px-3 py-1 text-sm rounded border transition-all ${
                    selectedRarities.includes(rarity)
                      ? selectedClass
                      : unselectedClass
                  }`}
                >
                  {rarity}
                </button>
              ))}
            </div>
          </div>

          {/* Art Filter */}
          <div>
            <h4 className="text-xs font-medium text-zinc-500 uppercase mb-2">Art</h4>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setArtFilter('all')}
                className={`px-3 py-1 text-sm rounded border transition-all ${
                  artFilter === 'all'
                    ? selectedClass
                    : unselectedClass
                }`}
              >
                All
              </button>
              <button
                onClick={() => setArtFilter('base')}
                className={`px-3 py-1 text-sm rounded border transition-all ${
                  artFilter === 'base'
                    ? selectedClass
                    : unselectedClass
                }`}
              >
                Base Only
              </button>
              <button
                onClick={() => setArtFilter('parallels')}
                className={`px-3 py-1 text-sm rounded border transition-all ${
                  artFilter === 'parallels'
                    ? "bg-amber-500 text-black border-amber-500"
                    : unselectedClass
                }`}
              >
                Parallels Only
              </button>
            </div>
          </div>

          {/* Sort */}
          <div>
            <h4 className="text-xs font-medium text-zinc-500 uppercase mb-2">Sort By</h4>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSortBy('price-desc')}
                className={`px-3 py-1 text-sm rounded border transition-all ${
                  sortBy === 'price-desc'
                    ? "bg-green-600 text-white border-green-600"
                    : unselectedClass
                }`}
              >
                Price
              </button>
              <button
                onClick={() => setSortBy('name-asc')}
                className={`px-3 py-1 text-sm rounded border transition-all ${
                  sortBy === 'name-asc'
                    ? selectedClass
                    : unselectedClass
                }`}
              >
                Name
              </button>
              <button
                onClick={() => setSortBy('id-asc')}
                className={`px-3 py-1 text-sm rounded border transition-all ${
                  sortBy === 'id-asc'
                    ? selectedClass
                    : unselectedClass
                }`}
              >
                Card #
              </button>
            </div>
          </div>
        </div>

        {/* Results count and clear */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-zinc-500">
            Showing {filteredCards.length} of {cards.length} cards
          </p>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-sm text-zinc-400 hover:text-white dark:hover:text-white light:hover:text-zinc-900 transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Card Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {filteredCards.map((card) => (
          <Link
            key={card.id}
            href={`/card/${card.id.toLowerCase()}`}
            className="block"
          >
            <CardThumbnail card={card} />
          </Link>
        ))}
      </div>

      {filteredCards.length === 0 && (
        <div className="text-center py-12 text-zinc-500">
          <p>No cards found matching your filters.</p>
          <button
            onClick={clearFilters}
            className="mt-2 text-red-400 hover:text-red-300 transition-colors"
          >
            Clear all filters
          </button>
        </div>
      )}
    </div>
  );
}
