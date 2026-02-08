"use client";

import { useState, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Card, CardColor, CardType, Rarity, ArtStyle } from "@/types/card";

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

type SortOption = 'price-desc' | 'price-asc' | 'name-asc' | 'id-asc';

export default function CardGrid({ cards, setId }: CardGridProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedColors, setSelectedColors] = useState<CardColor[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<CardType[]>([]);
  const [selectedRarities, setSelectedRarities] = useState<Rarity[]>([]);
  const [artFilter, setArtFilter] = useState<'all' | 'base' | 'parallels'>('all');
  const [selectedArtStyles, setSelectedArtStyles] = useState<ArtStyle[]>([]);
  const [sortBy, setSortBy] = useState<SortOption>('price-desc');
  const [priceFilter, setPriceFilter] = useState<'all' | 'has-price'>('all');

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

      // Art style filter (wanted, manga, etc.)
      if (selectedArtStyles.length > 0) {
        const cardArtStyle = card.artStyle || (card.isParallel ? 'alternate' : 'standard');
        if (!selectedArtStyles.includes(cardArtStyle)) {
          return false;
        }
      }

      // Price filter
      if (priceFilter === 'has-price' && card.price?.marketPrice == null) {
        return false;
      }

      return true;
    });

    // Sort the filtered cards
    return filtered.sort((a, b) => {
      switch (sortBy) {
        case 'price-desc':
          const priceA = a.price?.marketPrice ?? -1;
          const priceB = b.price?.marketPrice ?? -1;
          return priceB - priceA;
        case 'price-asc':
          const priceAscA = a.price?.marketPrice ?? Infinity;
          const priceAscB = b.price?.marketPrice ?? Infinity;
          return priceAscA - priceAscB;
        case 'name-asc':
          return a.name.localeCompare(b.name);
        case 'id-asc':
          return a.id.localeCompare(b.id);
        default:
          return 0;
      }
    });
  }, [cards, searchQuery, selectedColors, selectedTypes, selectedRarities, artFilter, selectedArtStyles, sortBy, priceFilter]);

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
    setSelectedArtStyles([]);
    setSortBy('price-desc');
    setPriceFilter('all');
  };

  const hasActiveFilters =
    searchQuery || selectedColors.length > 0 || selectedTypes.length > 0 || selectedRarities.length > 0 || artFilter !== 'all' || selectedArtStyles.length > 0 || priceFilter !== 'all';

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

          {/* Special Art Styles */}
          <div>
            <h4 className="text-xs font-medium text-zinc-500 uppercase mb-2">Special Art</h4>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => toggleFilter('wanted' as ArtStyle, selectedArtStyles, setSelectedArtStyles)}
                className={`px-3 py-1 text-sm rounded border transition-all ${
                  selectedArtStyles.includes('wanted')
                    ? "bg-orange-500 text-white border-orange-500"
                    : unselectedClass
                }`}
              >
                Wanted
              </button>
              <button
                onClick={() => toggleFilter('manga' as ArtStyle, selectedArtStyles, setSelectedArtStyles)}
                className={`px-3 py-1 text-sm rounded border transition-all ${
                  selectedArtStyles.includes('manga')
                    ? "bg-pink-500 text-white border-pink-500"
                    : unselectedClass
                }`}
              >
                Manga
              </button>
            </div>
          </div>

          {/* Price Filter */}
          <div>
            <h4 className="text-xs font-medium text-zinc-500 uppercase mb-2">Price</h4>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setPriceFilter('all')}
                className={`px-3 py-1 text-sm rounded border transition-all ${
                  priceFilter === 'all'
                    ? selectedClass
                    : unselectedClass
                }`}
              >
                All
              </button>
              <button
                onClick={() => setPriceFilter('has-price')}
                className={`px-3 py-1 text-sm rounded border transition-all ${
                  priceFilter === 'has-price'
                    ? "bg-green-600 text-white border-green-600"
                    : unselectedClass
                }`}
              >
                Has Price
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
                Price High
              </button>
              <button
                onClick={() => setSortBy('price-asc')}
                className={`px-3 py-1 text-sm rounded border transition-all ${
                  sortBy === 'price-asc'
                    ? "bg-green-600 text-white border-green-600"
                    : unselectedClass
                }`}
              >
                Price Low
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
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {filteredCards.map((card) => (
          <Link
            key={card.id}
            href={`/card/${card.id.toLowerCase()}`}
            className="group block"
          >
            <div className="aspect-[2.5/3.5] relative rounded-lg overflow-hidden bg-zinc-900 dark:bg-zinc-900 light:bg-zinc-100 border border-zinc-800 dark:border-zinc-800 light:border-zinc-200 group-hover:border-zinc-600 dark:group-hover:border-zinc-600 light:group-hover:border-zinc-400 transition-all">
              <Image
                src={card.imageUrl}
                alt={card.name}
                fill
                sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 16vw"
                className="object-cover"
                unoptimized
              />
              {card.isParallel && (
                <span className={`absolute top-1 right-1 px-1.5 py-0.5 text-[10px] font-bold rounded ${
                  card.artStyle === 'wanted' ? 'bg-orange-500 text-black' :
                  card.artStyle === 'manga' ? 'bg-pink-500 text-black' :
                  'bg-amber-500 text-black'
                }`}>
                  {card.artStyle === 'wanted' ? 'WANTED' :
                   card.artStyle === 'manga' ? 'MANGA' :
                   'ALT'}
                </span>
              )}
            </div>
            <div className="mt-2">
              <p className="text-xs text-zinc-500">{card.id}</p>
              <p className="text-sm font-medium truncate group-hover:text-red-400 transition-colors">
                {card.name}
              </p>
              <div className="flex items-center justify-between mt-1">
                <div className="flex items-center gap-1">
                  {card.colors.map((color) => (
                    <span
                      key={color}
                      className={`w-3 h-3 rounded-full ${
                        color === "Red" ? "bg-red-500" :
                        color === "Green" ? "bg-green-500" :
                        color === "Blue" ? "bg-blue-500" :
                        color === "Purple" ? "bg-purple-500" :
                        color === "Black" ? "bg-zinc-500" :
                        "bg-yellow-500"
                      }`}
                    />
                  ))}
                  <span className="text-xs text-zinc-500 ml-1">{card.rarity}</span>
                </div>
                {card.price?.marketPrice != null && (
                  <span className="text-xs font-medium text-green-400">
                    ${card.price.marketPrice.toFixed(2)}
                  </span>
                )}
              </div>
            </div>
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
