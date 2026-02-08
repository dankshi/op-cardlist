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

const colorClasses: Record<CardColor, string> = {
  Red: "bg-red-500/20 text-red-400 border-red-500/30",
  Green: "bg-green-500/20 text-green-400 border-green-500/30",
  Blue: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  Purple: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  Black: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  Yellow: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
};

export default function CardGrid({ cards, setId }: CardGridProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedColors, setSelectedColors] = useState<CardColor[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<CardType[]>([]);
  const [selectedRarities, setSelectedRarities] = useState<Rarity[]>([]);
  const [artFilter, setArtFilter] = useState<'all' | 'base' | 'parallels'>('all');
  const [selectedArtStyles, setSelectedArtStyles] = useState<ArtStyle[]>([]);

  const filteredCards = useMemo(() => {
    return cards.filter((card) => {
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

      return true;
    });
  }, [cards, searchQuery, selectedColors, selectedTypes, selectedRarities, artFilter, selectedArtStyles]);

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
  };

  const hasActiveFilters =
    searchQuery || selectedColors.length > 0 || selectedTypes.length > 0 || selectedRarities.length > 0 || artFilter !== 'all' || selectedArtStyles.length > 0;

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
            className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-lg text-white placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
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
                      ? colorClasses[color]
                      : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:border-zinc-600"
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
                      ? "bg-zinc-700 text-white border-zinc-600"
                      : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:border-zinc-600"
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
                      ? "bg-zinc-700 text-white border-zinc-600"
                      : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:border-zinc-600"
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
                    ? "bg-zinc-700 text-white border-zinc-600"
                    : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:border-zinc-600"
                }`}
              >
                All
              </button>
              <button
                onClick={() => setArtFilter('base')}
                className={`px-3 py-1 text-sm rounded border transition-all ${
                  artFilter === 'base'
                    ? "bg-zinc-700 text-white border-zinc-600"
                    : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:border-zinc-600"
                }`}
              >
                Base Only
              </button>
              <button
                onClick={() => setArtFilter('parallels')}
                className={`px-3 py-1 text-sm rounded border transition-all ${
                  artFilter === 'parallels'
                    ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                    : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:border-zinc-600"
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
                    ? "bg-orange-500/20 text-orange-400 border-orange-500/30"
                    : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:border-zinc-600"
                }`}
              >
                Wanted
              </button>
              <button
                onClick={() => toggleFilter('manga' as ArtStyle, selectedArtStyles, setSelectedArtStyles)}
                className={`px-3 py-1 text-sm rounded border transition-all ${
                  selectedArtStyles.includes('manga')
                    ? "bg-pink-500/20 text-pink-400 border-pink-500/30"
                    : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:border-zinc-600"
                }`}
              >
                Manga
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
              className="text-sm text-zinc-400 hover:text-white transition-colors"
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
            <div className="aspect-[2.5/3.5] relative rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800 group-hover:border-zinc-600 transition-all">
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
              <div className="flex items-center gap-1 mt-1">
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
