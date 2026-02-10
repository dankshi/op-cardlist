"use client";

import { useState, useMemo } from "react";
import type { Product, ProductCategory, ProductTag } from "@/types/card";

interface ProductGridProps {
  products: Product[];
}

type FilterCategory = 'all' | ProductCategory;

const CATEGORY_TABS: { value: FilterCategory; label: string; color: string }[] = [
  { value: 'all', label: 'All', color: 'bg-blue-600 text-white border-blue-600' },
  { value: 'boosters', label: 'Boosters', color: 'bg-sky-600 text-white border-sky-600' },
  { value: 'decks', label: 'Decks', color: 'bg-blue-600 text-white border-blue-600' },
  { value: 'other', label: 'Accessories', color: 'bg-purple-600 text-white border-purple-600' },
];

const TAG_CONFIG: { value: ProductTag; label: string }[] = [
  // Boosters
  { value: 'booster-packs', label: 'Booster Packs' },
  { value: 'extra-boosters', label: 'Extra Boosters' },
  { value: 'premium-boosters', label: 'Premium Boosters' },
  // Decks
  { value: 'starter-decks', label: 'Starter Decks' },
  { value: 'ultra-decks', label: 'Ultra Decks' },
  // Accessories
  { value: 'sleeves', label: 'Sleeves' },
  { value: 'playmats', label: 'Playmats' },
  { value: 'collections', label: 'Collections' },
  { value: 'double-packs', label: 'Double Packs' },
  { value: 'illustration-boxes', label: 'Illustration Boxes' },
  { value: 'anniversary-sets', label: 'Anniversary Sets' },
  { value: 'bundles', label: 'Bundles & Sets' },
  { value: 'storage', label: 'Storage Boxes' },
  { value: 'card-cases', label: 'Card Cases' },
  { value: 'don-sets', label: 'DON!! Sets' },
  { value: 'devil-fruits', label: 'Devil Fruits' },
  { value: 'tin-packs', label: 'Tin Packs' },
  { value: 'binders', label: 'Binders' },
  { value: 'misc', label: 'Other' },
];

const tagBadgeColors: Record<string, string> = {
  'booster-packs': 'bg-sky-500/20 text-sky-400',
  'extra-boosters': 'bg-orange-500/20 text-orange-400',
  'premium-boosters': 'bg-amber-500/20 text-amber-400',
  'starter-decks': 'bg-blue-500/20 text-blue-400',
  'ultra-decks': 'bg-indigo-500/20 text-indigo-400',
  sleeves: 'bg-purple-500/20 text-purple-400',
  playmats: 'bg-green-500/20 text-green-400',
  collections: 'bg-amber-500/20 text-amber-400',
  'double-packs': 'bg-orange-500/20 text-orange-400',
  'illustration-boxes': 'bg-pink-500/20 text-pink-400',
  'anniversary-sets': 'bg-yellow-500/20 text-yellow-400',
  bundles: 'bg-cyan-500/20 text-cyan-400',
  storage: 'bg-emerald-500/20 text-emerald-400',
  'card-cases': 'bg-teal-500/20 text-teal-400',
  'don-sets': 'bg-rose-500/20 text-rose-400',
  'devil-fruits': 'bg-violet-500/20 text-violet-400',
  'tin-packs': 'bg-sky-500/20 text-sky-400',
  binders: 'bg-indigo-500/20 text-indigo-400',
  misc: 'bg-zinc-500/20 text-zinc-400',
};

function getBadgeLabel(product: Product): string {
  const tagInfo = TAG_CONFIG.find(t => t.value === product.tag);
  return tagInfo?.label.toUpperCase() ?? 'OTHER';
}

function getBadgeColor(product: Product): string {
  return tagBadgeColors[product.tag] ?? tagBadgeColors.misc;
}

const unselectedClass = "bg-zinc-800 dark:bg-zinc-800 light:bg-zinc-100 text-zinc-400 dark:text-zinc-400 light:text-zinc-600 border-zinc-700 dark:border-zinc-700 light:border-zinc-300 hover:border-zinc-500 dark:hover:border-zinc-500 light:hover:border-zinc-400";
const selectedClass = "bg-blue-600 text-white border-blue-600";

type SortOption = 'newest' | 'oldest' | 'name-asc' | 'price-asc';

function parseReleaseDate(dateStr: string | null): number {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function parseMsrp(msrp: string | null): number {
  if (!msrp) return 0;
  const match = msrp.match(/\$([\d.]+)/);
  return match ? parseFloat(match[1]) : 0;
}

export default function ProductGrid({ products }: ProductGridProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<FilterCategory>('all');
  const [selectedTags, setSelectedTags] = useState<ProductTag[]>([]);
  const [sortBy, setSortBy] = useState<SortOption>('newest');

  // Compute which tags are relevant to show based on selected category
  const availableTags = useMemo(() => {
    const categoryProducts = selectedCategory === 'all'
      ? products
      : products.filter(p => p.category === selectedCategory);

    const tagCounts = new Map<ProductTag, number>();
    for (const p of categoryProducts) {
      tagCounts.set(p.tag, (tagCounts.get(p.tag) || 0) + 1);
    }

    return TAG_CONFIG
      .filter(t => tagCounts.has(t.value))
      .map(t => ({ ...t, count: tagCounts.get(t.value)! }));
  }, [products, selectedCategory]);

  const filteredProducts = useMemo(() => {
    const filtered = products.filter((product) => {
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          product.name.toLowerCase().includes(query) ||
          (product.description?.toLowerCase().includes(query) ?? false);
        if (!matchesSearch) return false;
      }

      if (selectedCategory !== 'all' && product.category !== selectedCategory) {
        return false;
      }

      if (selectedTags.length > 0 && !selectedTags.includes(product.tag)) {
        return false;
      }

      return true;
    });

    return filtered.sort((a, b) => {
      switch (sortBy) {
        case 'newest':
          return parseReleaseDate(b.releaseDate) - parseReleaseDate(a.releaseDate);
        case 'oldest':
          return parseReleaseDate(a.releaseDate) - parseReleaseDate(b.releaseDate);
        case 'name-asc':
          return a.name.localeCompare(b.name);
        case 'price-asc':
          return parseMsrp(a.msrp) - parseMsrp(b.msrp);
        default:
          return 0;
      }
    });
  }, [products, searchQuery, selectedCategory, selectedTags, sortBy]);

  const toggleTag = (tag: ProductTag) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const clearFilters = () => {
    setSearchQuery("");
    setSelectedCategory('all');
    setSelectedTags([]);
    setSortBy('newest');
  };

  const hasActiveFilters = searchQuery || selectedCategory !== 'all' || selectedTags.length > 0;

  return (
    <div>
      {/* Search and Filters */}
      <div className="mb-8 space-y-4">
        {/* Search */}
        <div className="relative">
          <input
            type="text"
            placeholder="Search products by name..."
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
          {/* Category Tabs */}
          <div>
            <h4 className="text-xs font-medium text-zinc-500 uppercase mb-2">Category</h4>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_TABS.map((cat) => (
                <button
                  key={cat.value}
                  onClick={() => {
                    setSelectedCategory(cat.value);
                    setSelectedTags([]);
                  }}
                  className={`px-3 py-1 text-sm rounded border transition-all ${
                    selectedCategory === cat.value
                      ? cat.color
                      : unselectedClass
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sort */}
          <div>
            <h4 className="text-xs font-medium text-zinc-500 uppercase mb-2">Sort By</h4>
            <div className="flex flex-wrap gap-2">
              {([
                { value: 'newest', label: 'Newest' },
                { value: 'oldest', label: 'Oldest' },
                { value: 'name-asc', label: 'Name' },
                { value: 'price-asc', label: 'Price' },
              ] as { value: SortOption; label: string }[]).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setSortBy(opt.value)}
                  className={`px-3 py-1 text-sm rounded border transition-all ${
                    sortBy === opt.value ? selectedClass : unselectedClass
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Tag Filters - show when there are multiple tags available */}
        {availableTags.length > 1 && (
          <div>
            <h4 className="text-xs font-medium text-zinc-500 uppercase mb-2">Type</h4>
            <div className="flex flex-wrap gap-2">
              {availableTags.map((tag) => (
                <button
                  key={tag.value}
                  onClick={() => toggleTag(tag.value)}
                  className={`px-3 py-1 text-sm rounded border transition-all ${
                    selectedTags.includes(tag.value)
                      ? "bg-purple-600 text-white border-purple-600"
                      : unselectedClass
                  }`}
                >
                  {tag.label}
                  <span className="ml-1 opacity-60">{tag.count}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Results count and clear */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-zinc-500">
            Showing {filteredProducts.length} of {products.length} products
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

      {/* Product Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {filteredProducts.map((product) => (
          <a
            key={product.id}
            href={product.detailUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block bg-zinc-900 light:bg-white rounded-lg border border-zinc-800 light:border-zinc-200 hover:border-zinc-700 light:hover:border-zinc-300 hover:bg-zinc-800/50 light:hover:bg-zinc-50 transition-all group overflow-hidden"
          >
            <div className="relative w-full aspect-square bg-white">
              <img
                src={product.detailImages?.[0] || product.thumbnailUrl}
                alt={product.name}
                className="w-full h-full object-contain p-3 group-hover:scale-105 transition-transform duration-300"
                loading="lazy"
              />
            </div>
            <div className="p-3">
              <h3 className="font-semibold text-sm group-hover:text-sky-500 transition-colors line-clamp-2 leading-snug">
                {product.name}
              </h3>
              {product.msrp && (
                <p className="text-zinc-400 text-xs mt-1">
                  MSRP {product.msrp}
                </p>
              )}
            </div>
          </a>
        ))}
      </div>

      {filteredProducts.length === 0 && (
        <div className="text-center py-12 text-zinc-500">
          <p>No products found matching your filters.</p>
          <button
            onClick={clearFilters}
            className="mt-2 text-sky-500 hover:text-sky-400 light:text-sky-600 light:hover:text-sky-700 transition-colors"
          >
            Clear all filters
          </button>
        </div>
      )}
    </div>
  );
}
