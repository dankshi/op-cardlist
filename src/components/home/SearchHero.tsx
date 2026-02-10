"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { SearchIndexEntry } from "@/lib/cards";

export function SearchHero() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fetchInitiated = useRef(false);

  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<SearchIndexEntry[] | null>(null);
  const [results, setResults] = useState<SearchIndexEntry[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);

  const loadIndex = useCallback(async () => {
    if (fetchInitiated.current) return;
    fetchInitiated.current = true;
    setIsLoading(true);
    try {
      const res = await fetch("/api/search-index");
      const data = await res.json();
      setIndex(data.cards);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Filter results when query or index changes
  useEffect(() => {
    if (!index || !query.trim()) {
      setResults([]);
      return;
    }
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    const filtered = index
      .filter(
        (card) =>
          regex.test(card.name) ||
          regex.test(card.id)
      )
      .slice(0, 8);
    setResults(filtered);
    setSelectedIndex(-1);
  }, [query, index]);

  // Global Ctrl+K / Cmd+K shortcut
  useEffect(() => {
    const handleGlobalKeydown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        loadIndex();
      }
    };
    document.addEventListener("keydown", handleGlobalKeydown);
    return () => document.removeEventListener("keydown", handleGlobalKeydown);
  }, [loadIndex]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev < results.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIndex >= 0 && results[selectedIndex]) {
        router.push(`/card/${results[selectedIndex].id.toLowerCase()}`);
        setIsOpen(false);
      } else if (query.trim()) {
        router.push(`/search?q=${encodeURIComponent(query.trim())}`);
        setIsOpen(false);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
      inputRef.current?.blur();
    }
  };

  const showDropdown =
    isOpen && (query.trim().length > 0 || isLoading);

  return (
    <div ref={containerRef} className="relative w-full max-w-2xl mx-auto">
      <div className="relative">
        {/* Search icon */}
        <svg
          className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>

        <input
          ref={inputRef}
          type="text"
          placeholder="Search cards by name or ID..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            setIsOpen(true);
            loadIndex();
          }}
          onKeyDown={handleKeyDown}
          className="w-full pl-14 pr-20 py-4 text-lg bg-zinc-900/80 light:bg-white/80 backdrop-blur-xl border border-zinc-700/50 light:border-zinc-300/50 rounded-2xl text-white light:text-zinc-900 placeholder:text-zinc-500 focus:outline-none focus:border-sky-500/50 focus:ring-2 focus:ring-sky-500/20 shadow-2xl shadow-black/20 light:shadow-zinc-300/30 transition-all"
        />

        {/* Keyboard shortcut hint */}
        {!query && (
          <kbd className="absolute right-5 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center gap-1 px-2 py-1 text-xs text-zinc-500 bg-zinc-800/80 light:bg-zinc-200/80 rounded border border-zinc-700/50 light:border-zinc-300/50 font-mono">
            <span className="text-[10px]">Ctrl</span>
            <span>K</span>
          </kbd>
        )}

        {/* Clear button */}
        {query && (
          <button
            onClick={() => {
              setQuery("");
              setResults([]);
              inputRef.current?.focus();
            }}
            className="absolute right-5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white light:hover:text-zinc-900 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Dropdown */}
      {showDropdown && (
        <div className="absolute top-full mt-2 w-full bg-zinc-900/95 light:bg-white/95 backdrop-blur-xl border border-zinc-700/50 light:border-zinc-300/50 rounded-xl shadow-2xl shadow-black/40 max-h-96 overflow-y-auto z-50">
          {isLoading ? (
            <div className="p-6 text-center text-zinc-500">
              <div className="animate-spin w-5 h-5 border-2 border-zinc-500 border-t-transparent rounded-full mx-auto mb-2" />
              Loading cards...
            </div>
          ) : results.length > 0 ? (
            <>
              {results.map((card, i) => (
                <Link
                  key={card.id}
                  href={`/card/${card.id.toLowerCase()}`}
                  className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                    i === selectedIndex
                      ? "bg-zinc-800 light:bg-zinc-100"
                      : "hover:bg-zinc-800/50 light:hover:bg-zinc-50"
                  }`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setIsOpen(false)}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  <img
                    src={card.imageUrl}
                    alt=""
                    className="w-10 h-14 object-cover rounded flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate text-sm">
                      {card.name}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {card.id} &middot; {card.setId.toUpperCase()}
                    </p>
                  </div>
                  {card.marketPrice != null && (
                    <span className="text-green-400 font-bold text-sm flex-shrink-0">
                      ${card.marketPrice.toFixed(2)}
                    </span>
                  )}
                </Link>
              ))}
              <Link
                href={`/search?q=${encodeURIComponent(query)}`}
                className="block px-4 py-3 text-sm text-center text-sky-400 light:text-sky-600 hover:text-sky-300 light:hover:text-sky-700 hover:bg-zinc-800/50 light:hover:bg-zinc-50 border-t border-zinc-800 light:border-zinc-200 transition-colors"
                onClick={() => setIsOpen(false)}
              >
                View all results for &ldquo;{query}&rdquo;
              </Link>
            </>
          ) : query.trim() ? (
            <div className="p-6 text-center text-zinc-500">
              No cards found for &ldquo;{query}&rdquo;
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
