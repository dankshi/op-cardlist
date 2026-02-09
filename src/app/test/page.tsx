"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Image from "next/image";
import type { Card, CardPrice } from "@/types/card";

interface CardWithPrice extends Card {
  price?: CardPrice;
}

interface TCGProduct {
  productId: number;
  productName: string;
  marketPrice: number | null;
  lowPrice: number | null;
  number: string;
  url: string;
  imageUrl: string;
}

// Encouraging messages for Melody
const ENCOURAGEMENT_MESSAGES = [
  "Amazing work, Melody!",
  "You're on fire!",
  "Crushing it!",
  "Another one fixed!",
  "Fantastic job!",
  "Unstoppable!",
  "You're a wizard!",
  "So proud of you!",
  "You're incredible!",
  "Another card saved!",
  "MVP!",
  "Great job!",
];

const MILESTONE_MESSAGES: Record<number, string> = {
  1: "First card fixed! Welcome to the team!",
  5: "5 cards! You're getting the hang of this!",
  10: "Double digits! 10 cards!",
  25: "25 cards! You're a pro!",
  50: "FIFTY cards! Incredible!",
  100: "100 CARDS! Legend!",
};

export default function TestPage() {
  const [cards, setCards] = useState<CardWithPrice[]>([]);
  const [prices, setPrices] = useState<Record<string, CardPrice>>({});
  const [fixedCards, setFixedCards] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'issues' | 'all' | 'fixed'>('issues');
  const [selectedSet, setSelectedSet] = useState<string>('all');
  const [sets, setSets] = useState<string[]>([]);

  // Modal state - now just a single card
  const [selectedCard, setSelectedCard] = useState<CardWithPrice | null>(null);
  const [searchResults, setSearchResults] = useState<TCGProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [manualUrl, setManualUrl] = useState('');
  const [saving, setSaving] = useState(false);

  // Contributor tracking
  const [adminKey, setAdminKey] = useState<string>('');
  const [contributorName, setContributorName] = useState<string>('');
  const [sessionFixes, setSessionFixes] = useState(0);
  const [totalFixes, setTotalFixes] = useState(0);
  const [encouragement, setEncouragement] = useState<string | null>(null);

  useEffect(() => {
    const savedAdminKey = localStorage.getItem('admin-key');
    const savedContributor = localStorage.getItem('contributor-name');
    const savedTotalFixes = localStorage.getItem('total-fixes');
    if (savedAdminKey) setAdminKey(savedAdminKey);
    if (savedContributor) setContributorName(savedContributor);
    if (savedTotalFixes) setTotalFixes(parseInt(savedTotalFixes) || 0);
  }, []);

  useEffect(() => {
    fetch('/api/cards')
      .then(res => res.json())
      .then(data => {
        setCards(data.cards || []);
        const uniqueSets = [...new Set(data.cards?.map((c: Card) => c.setId) || [])] as string[];
        setSets(uniqueSets.sort());
      })
      .catch(console.error);

    fetch('/api/prices')
      .then(res => res.json())
      .then(data => setPrices(data.prices || {}))
      .catch(console.error);

    const savedFixed = localStorage.getItem('fixed-cards');
    if (savedFixed) {
      setFixedCards(new Set(JSON.parse(savedFixed)));
    }
  }, []);

  // Detect issues
  const { cardIssues, issueCards } = useMemo(() => {
    const productIdUsage: Record<number, string[]> = {};
    const issues: Record<string, { isDuplicate: boolean; isUnmapped: boolean }> = {};

    cards.forEach(card => {
      const productId = prices[card.id]?.tcgplayerProductId;
      if (productId) {
        if (!productIdUsage[productId]) productIdUsage[productId] = [];
        productIdUsage[productId].push(card.id);
      } else {
        issues[card.id] = { isDuplicate: false, isUnmapped: true };
      }
    });

    // Mark duplicates
    Object.values(productIdUsage).forEach(cardIds => {
      if (cardIds.length > 1) {
        cardIds.forEach(id => {
          issues[id] = { ...issues[id], isDuplicate: true, isUnmapped: false };
        });
      }
    });

    const cardsWithIssues = cards.filter(c => issues[c.id]);
    return { cardIssues: issues, issueCards: cardsWithIssues };
  }, [cards, prices]);

  // Filter cards
  const filteredCards = useMemo(() => {
    let result = cards;

    // Filter by set
    if (selectedSet !== 'all') {
      result = result.filter(c => c.setId === selectedSet);
    }

    // Filter by type
    switch (filter) {
      case 'issues':
        result = result.filter(c => cardIssues[c.id]);
        break;
      case 'fixed':
        result = result.filter(c => fixedCards.has(c.id));
        break;
    }

    // Sort: duplicates first, then unmapped
    return result.sort((a, b) => {
      const aIsDupe = cardIssues[a.id]?.isDuplicate ? 1 : 0;
      const bIsDupe = cardIssues[b.id]?.isDuplicate ? 1 : 0;
      return bIsDupe - aIsDupe;
    });
  }, [cards, selectedSet, filter, cardIssues, fixedCards]);

  // Navigation
  const currentIndex = selectedCard ? filteredCards.findIndex(c => c.id === selectedCard.id) : -1;

  const goToNext = useCallback(() => {
    if (currentIndex < filteredCards.length - 1) {
      openCard(filteredCards[currentIndex + 1]);
    }
  }, [currentIndex, filteredCards]);

  const goToPrev = useCallback(() => {
    if (currentIndex > 0) {
      openCard(filteredCards[currentIndex - 1]);
    }
  }, [currentIndex, filteredCards]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedCard) return;
      if (e.key === 'ArrowRight' || e.key === 'n') goToNext();
      if (e.key === 'ArrowLeft' || e.key === 'p') goToPrev();
      if (e.key === 'Escape') setSelectedCard(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedCard, goToNext, goToPrev]);

  const openCard = async (card: CardWithPrice) => {
    setSelectedCard(card);
    setSearchResults([]);
    setSearching(true);
    setManualUrl('');

    const cardNum = card.baseId.match(/-(\d+)$/)?.[1] || '';

    try {
      const res = await fetch(
        `/api/tcgplayer-search?name=${encodeURIComponent(card.name)}&number=${cardNum}&baseId=${encodeURIComponent(card.baseId)}`
      );
      const data = await res.json();
      setSearchResults(data.products || []);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setSearching(false);
    }
  };

  const parseManualUrl = (url: string): TCGProduct | null => {
    const match = url.match(/tcgplayer\.com\/product\/(\d+)/);
    if (match) {
      const productId = parseInt(match[1]);
      return {
        productId,
        productName: `Product #${productId}`,
        marketPrice: null,
        lowPrice: null,
        number: '',
        url: url,
        imageUrl: `https://product-images.tcgplayer.com/fit-in/400x558/${productId}.jpg`,
      };
    }
    return null;
  };

  const showEncouragement = (newTotal: number) => {
    const msg = MILESTONE_MESSAGES[newTotal] ||
      ENCOURAGEMENT_MESSAGES[Math.floor(Math.random() * ENCOURAGEMENT_MESSAGES.length)];
    setEncouragement(msg);
    setTimeout(() => setEncouragement(null), 3000);
  };

  const assignProduct = async (product: TCGProduct) => {
    if (!selectedCard || saving) return;
    setSaving(true);

    const name = contributorName || 'Melody';

    try {
      const res = await fetch('/api/mappings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(adminKey && { 'x-admin-key': adminKey }),
        },
        body: JSON.stringify([{
          cardId: selectedCard.id,
          tcgProductId: product.productId,
          tcgUrl: product.url,
          tcgName: product.productName,
          price: product.marketPrice,
          submittedBy: name,
        }]),
      });

      if (res.ok) {
        const newFixed = new Set(fixedCards);
        newFixed.add(selectedCard.id);
        setFixedCards(newFixed);
        localStorage.setItem('fixed-cards', JSON.stringify([...newFixed]));

        const newSession = sessionFixes + 1;
        const newTotal = totalFixes + 1;
        setSessionFixes(newSession);
        setTotalFixes(newTotal);
        localStorage.setItem('total-fixes', String(newTotal));

        showEncouragement(newTotal);

        // Auto-advance to next card
        if (currentIndex < filteredCards.length - 1) {
          setTimeout(() => openCard(filteredCards[currentIndex + 1]), 500);
        } else {
          setSelectedCard(null);
        }
      }
    } catch (error) {
      console.error('Failed to save:', error);
    } finally {
      setSaving(false);
    }
  };

  const getTcgplayerImageUrl = (productId: number) => {
    return `https://product-images.tcgplayer.com/fit-in/400x558/${productId}.jpg`;
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Fix Card Mappings</h1>
            <p className="text-zinc-400">Click a card to assign the correct TCGPlayer link</p>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <input
                type="text"
                placeholder="Your name"
                value={contributorName}
                onChange={(e) => {
                  setContributorName(e.target.value);
                  localStorage.setItem('contributor-name', e.target.value);
                }}
                className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg w-32 text-sm"
              />
              <input
                type="password"
                placeholder="Admin key"
                value={adminKey}
                onChange={(e) => {
                  setAdminKey(e.target.value);
                  localStorage.setItem('admin-key', e.target.value);
                }}
                className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg w-28 text-sm"
              />
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-400">{sessionFixes}</div>
              <div className="text-xs text-zinc-500">Session</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-400">{totalFixes}</div>
              <div className="text-xs text-zinc-500">Total</div>
            </div>
          </div>
        </div>

        {/* Encouragement */}
        {encouragement && (
          <div className="mb-4 p-4 bg-gradient-to-r from-pink-500/20 to-purple-500/20 border border-pink-400/50 rounded-lg text-center">
            <span className="text-xl font-bold text-pink-300">{encouragement}</span>
          </div>
        )}

        {/* Filters */}
        <div className="mb-6 flex flex-wrap gap-4 items-center">
          <div className="flex gap-2">
            {(['issues', 'fixed', 'all'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2 rounded-lg font-medium ${
                  filter === f
                    ? f === 'issues' ? 'bg-red-600' : 'bg-blue-600'
                    : 'bg-zinc-800 hover:bg-zinc-700'
                }`}
              >
                {f === 'issues' ? `Issues (${issueCards.length})` :
                 f === 'fixed' ? `Fixed (${fixedCards.size})` : 'All'}
              </button>
            ))}
          </div>

          <select
            value={selectedSet}
            onChange={(e) => setSelectedSet(e.target.value)}
            className="px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg"
          >
            <option value="all">All Sets</option>
            {sets.map(s => (
              <option key={s} value={s}>{s.toUpperCase()}</option>
            ))}
          </select>

          <span className="text-zinc-500 ml-auto">
            {filteredCards.length} cards
          </span>
        </div>

        {/* Cards Grid */}
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-3">
          {filteredCards.map(card => {
            const isFixed = fixedCards.has(card.id);
            const issue = cardIssues[card.id];
            const productId = prices[card.id]?.tcgplayerProductId;

            return (
              <div
                key={card.id}
                onClick={() => openCard(card)}
                className={`cursor-pointer rounded-lg overflow-hidden border-2 transition-all hover:scale-105 ${
                  isFixed ? 'border-green-500' :
                  issue?.isDuplicate ? 'border-red-500' :
                  issue?.isUnmapped ? 'border-orange-500' :
                  'border-zinc-700'
                }`}
              >
                <div className="aspect-[2.5/3.5] relative bg-zinc-800">
                  <Image
                    src={card.imageUrl}
                    alt={card.name}
                    fill
                    className="object-cover"
                    unoptimized
                  />
                  {/* Status badge */}
                  <div className="absolute top-1 right-1">
                    {isFixed && (
                      <span className="px-1.5 py-0.5 bg-green-600 rounded text-[10px] font-bold">✓</span>
                    )}
                    {issue?.isDuplicate && !isFixed && (
                      <span className="px-1.5 py-0.5 bg-red-600 rounded text-[10px] font-bold">DUP</span>
                    )}
                    {issue?.isUnmapped && !isFixed && (
                      <span className="px-1.5 py-0.5 bg-orange-600 rounded text-[10px] font-bold">?</span>
                    )}
                  </div>
                </div>
                <div className="p-1.5 bg-zinc-900">
                  <div className="text-[10px] font-mono text-zinc-400 truncate">{card.id}</div>
                </div>
              </div>
            );
          })}
        </div>

        {filteredCards.length === 0 && (
          <div className="text-center py-16 text-zinc-500">
            No cards to show
          </div>
        )}
      </div>

      {/* Modal - Clean side-by-side layout */}
      {selectedCard && (
        <div className="fixed inset-0 bg-black/95 z-50 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-zinc-800">
            <button
              onClick={goToPrev}
              disabled={currentIndex <= 0}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 rounded-lg"
            >
              ← Prev
            </button>
            <div className="text-center">
              <span className="font-mono text-blue-400 font-bold">{selectedCard.id}</span>
              <span className="text-zinc-400 ml-2">{selectedCard.name}</span>
              <span className="text-zinc-600 ml-2">({currentIndex + 1}/{filteredCards.length})</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={goToNext}
                disabled={currentIndex >= filteredCards.length - 1}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 rounded-lg"
              >
                Next →
              </button>
              <button
                onClick={() => setSelectedCard(null)}
                className="px-4 py-2 bg-zinc-800 hover:bg-red-600/50 rounded-lg"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Main content - side by side */}
          <div className="flex-1 flex overflow-hidden">
            {/* Left side - Our card */}
            <div className="w-80 shrink-0 p-6 border-r border-zinc-800 flex flex-col items-center">
              <h3 className="text-green-400 font-bold mb-4">Our Image (Correct)</h3>
              <div className="w-64 aspect-[2.5/3.5] relative rounded-lg overflow-hidden ring-4 ring-green-500 bg-zinc-800">
                <Image
                  src={selectedCard.imageUrl}
                  alt={selectedCard.name}
                  fill
                  className="object-cover"
                  unoptimized
                />
              </div>
              <div className="mt-4 text-center">
                <div className="font-mono text-lg">{selectedCard.id}</div>
                {selectedCard.isParallel && (
                  <span className={`inline-block mt-2 px-3 py-1 rounded text-sm font-bold ${
                    selectedCard.artStyle === 'manga' ? 'bg-pink-500 text-black' :
                    selectedCard.artStyle === 'wanted' ? 'bg-orange-500 text-black' :
                    'bg-amber-500 text-black'
                  }`}>
                    {selectedCard.artStyle === 'manga' ? 'MANGA' :
                     selectedCard.artStyle === 'wanted' ? 'WANTED' : 'ALT ART'}
                  </span>
                )}
              </div>

              {saving && (
                <div className="mt-4 text-yellow-400 animate-pulse">Saving...</div>
              )}
            </div>

            {/* Right side - TCGPlayer products */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* URL input */}
              <div className="p-4 border-b border-zinc-800 flex gap-2">
                <input
                  type="text"
                  placeholder="Paste TCGPlayer URL..."
                  value={manualUrl}
                  onChange={(e) => setManualUrl(e.target.value)}
                  className="flex-1 px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg"
                />
                <button
                  onClick={() => {
                    const product = parseManualUrl(manualUrl);
                    if (product) {
                      setSearchResults(prev => [product, ...prev]);
                      setManualUrl('');
                    }
                  }}
                  disabled={!manualUrl.includes('tcgplayer.com/product/')}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 rounded-lg"
                >
                  Add
                </button>
              </div>

              {/* Products grid */}
              <div className="flex-1 overflow-y-auto p-4">
                <h3 className="text-yellow-400 font-bold mb-4">
                  Click to assign TCGPlayer product:
                </h3>

                {searching ? (
                  <div className="text-center py-12 text-zinc-400">Searching...</div>
                ) : searchResults.length === 0 ? (
                  <div className="text-center py-12 text-zinc-400">
                    No products found
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                    {searchResults.map((product) => (
                      <div
                        key={product.productId}
                        onClick={() => assignProduct(product)}
                        className="cursor-pointer p-3 rounded-lg border-2 border-zinc-700 bg-zinc-800 hover:border-blue-500 hover:bg-blue-500/10 transition-all"
                      >
                        <div className="aspect-[2.5/3.5] relative rounded overflow-hidden bg-zinc-700 mb-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={product.imageUrl}
                            alt={product.productName}
                            className="absolute inset-0 w-full h-full object-contain"
                          />
                        </div>
                        <div className="text-xs text-zinc-400 truncate">{product.number}</div>
                        <div className="text-sm truncate">{product.productName}</div>
                        {product.marketPrice && (
                          <div className="text-green-400 font-bold mt-1">
                            ${product.marketPrice.toFixed(2)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Google search link */}
                <div className="mt-6 pt-6 border-t border-zinc-800 text-center">
                  <a
                    href={`https://www.google.com/search?q=${encodeURIComponent(selectedCard.baseId.replace(/_p\d+$/, ''))} tcgplayer one piece`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-300"
                  >
                    🔍 Search Google for {selectedCard.baseId.replace(/_p\d+$/, '')}
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
