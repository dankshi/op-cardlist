"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
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

// Type for database mappings
interface DbMapping {
  tcgProductId: number;
  tcgUrl: string;
  tcgName: string;
  price: number | null;
  artStyle: string | null;
  approved: boolean;
}

export default function TestPage() {
  const [cards, setCards] = useState<CardWithPrice[]>([]);
  const [prices, setPrices] = useState<Record<string, CardPrice>>({});
  const [dbMappings, setDbMappings] = useState<Record<string, DbMapping>>({}); // Mappings from Supabase
  const [filter, setFilter] = useState<'issues' | 'all' | 'fixed'>('issues');
  const [selectedSet, setSelectedSet] = useState<string>('all');
  const [sets, setSets] = useState<string[]>([]);

  // Modal state - now just a single card
  const [selectedCard, setSelectedCard] = useState<CardWithPrice | null>(null);
  const [searchResults, setSearchResults] = useState<TCGProduct[]>([]);
  const [googleResults, setGoogleResults] = useState<TCGProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchingGoogle, setSearchingGoogle] = useState(false);
  const [manualUrl, setManualUrl] = useState('');
  const [saving, setSaving] = useState(false);

  // Contributor tracking
  const [adminKey, setAdminKey] = useState<string>('');
  const [contributorName, setContributorName] = useState<string>('');
  const [sessionFixes, setSessionFixes] = useState(0);
  const [encouragement, setEncouragement] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [hideJollyRogerWarning, setHideJollyRogerWarning] = useState(false);
  const [showJollyRogerExpanded, setShowJollyRogerExpanded] = useState(false);
  const [showProblemInput, setShowProblemInput] = useState(false);
  const [problemReason, setProblemReason] = useState('');
  const [customProblemReasons, setCustomProblemReasons] = useState<string[]>([]);
  const urlInputRef = useRef<HTMLInputElement>(null);

  // Preset problem reasons
  const PRESET_REASONS = [
    'Product is already mapped',
    'Card not found on TCGPlayer',
    'Our image is wrong/missing',
    'Multiple variants exist',
  ];

  useEffect(() => {
    const savedAdminKey = localStorage.getItem('admin-key');
    const savedContributor = localStorage.getItem('contributor-name');
    if (savedAdminKey) setAdminKey(savedAdminKey);
    if (savedContributor) setContributorName(savedContributor);
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

    // Fetch mappings from database
    fetch('/api/mappings')
      .then(res => res.json())
      .then(data => setDbMappings(data.mappings || {}))
      .catch(console.error);

    // Fetch custom problem reasons
    fetch('/api/problems/reasons')
      .then(res => res.json())
      .then(data => setCustomProblemReasons(data.reasons || []))
      .catch(console.error);
  }, []);

  // Cards are "fixed" if they have a row in the database
  const fixedCards = useMemo(() => new Set(Object.keys(dbMappings)), [dbMappings]);

  // Build lookup of base card IDs that have PRB-01 (Jolly Roger) variants
  const jollyRogerCards = useMemo(() => {
    const prbCards = new Set<string>();
    cards.forEach(card => {
      if (card.setId === 'prb-01') {
        // Extract the original card ID pattern (e.g., OP01-041 from PRB-01 version)
        // PRB-01 cards reprint cards from other sets
        const baseMatch = card.baseId.match(/^([A-Z]+-?\d+)-(\d+)/);
        if (baseMatch) {
          prbCards.add(`${baseMatch[1]}-${baseMatch[2]}`); // e.g., "OP01-041"
        }
      }
    });
    return prbCards;
  }, [cards]);

  // Detect issues (duplicates and unmapped cards)
  const { cardIssues, issueCards } = useMemo(() => {
    const productIdUsage: Record<number, string[]> = {};
    const issues: Record<string, { isDuplicate: boolean; isUnmapped: boolean }> = {};

    cards.forEach(card => {
      const productId = prices[card.id]?.tcgplayerProductId;
      if (productId) {
        if (!productIdUsage[productId]) {
          productIdUsage[productId] = [];
        }
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
        // Exclude fixed cards from issues view
        result = result.filter(c => cardIssues[c.id] && !fixedCards.has(c.id));
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
    setGoogleResults([]);
    setSearching(true);
    setSearchingGoogle(true);
    setManualUrl('');
    setAssignError(null);
    setShowProblemInput(false);
    setProblemReason('');
    // Don't reset hideJollyRogerWarning - keep user preference across cards

    const cardNum = card.baseId.match(/-(\d+)$/)?.[1] || '';

    // Fetch both TCGPlayer API and Google search in parallel
    const tcgSearch = fetch(
      `/api/tcgplayer-search?name=${encodeURIComponent(card.name)}&number=${cardNum}&baseId=${encodeURIComponent(card.baseId)}`
    ).then(res => res.json()).catch(() => ({ products: [] }));

    const googleSearch = fetch(
      `/api/google-tcg-search?q=${encodeURIComponent(`${card.baseId.replace(/_p\d+$/, '')} ${card.name} one piece tcg`)}`
    ).then(res => res.json()).catch(() => ({ results: [] }));

    // Handle TCGPlayer results
    tcgSearch.then(data => {
      setSearchResults(data.products || []);
      setSearching(false);
    });

    // Handle Google results
    googleSearch.then(data => {
      const results = (data.results || []).map((r: { productId: number; title: string; url: string; imageUrl: string }) => ({
        productId: r.productId,
        productName: r.title,
        marketPrice: null,
        lowPrice: null,
        number: '',
        url: r.url,
        imageUrl: r.imageUrl,
      }));
      setGoogleResults(results);
      setSearchingGoogle(false);
    });
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
    setAssignError(null);

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
        // Update prices state immediately so the UI reflects the new mapping
        setPrices(prev => ({
          ...prev,
          [selectedCard.id]: {
            ...prev[selectedCard.id],
            tcgplayerProductId: product.productId,
            tcgplayerUrl: product.url,
            marketPrice: product.marketPrice,
          }
        }));

        // Update dbMappings so "FIXED" status updates
        setDbMappings(prev => ({
          ...prev,
          [selectedCard.id]: {
            tcgProductId: product.productId,
            tcgUrl: product.url,
            tcgName: product.productName,
            price: product.marketPrice,
            artStyle: null,
            approved: true,
          }
        }));

        const newSession = sessionFixes + 1;
        setSessionFixes(newSession);

        showEncouragement(newSession);

        // Auto-advance to next card after a brief delay
        if (currentIndex < filteredCards.length - 1) {
          setTimeout(() => openCard(filteredCards[currentIndex + 1]), 800);
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

  // Quick confirm - use existing TCG mapping from prices data
  const confirmLooksRight = async (card: CardWithPrice, e?: React.MouseEvent) => {
    if (e) e.stopPropagation(); // Don't open modal when clicking button
    if (saving) return;

    const cardPrice = prices[card.id];
    if (!cardPrice?.tcgplayerProductId || !cardPrice?.tcgplayerUrl) {
      console.error('No existing mapping to confirm');
      return;
    }

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
          cardId: card.id,
          tcgProductId: cardPrice.tcgplayerProductId,
          tcgUrl: cardPrice.tcgplayerUrl,
          tcgName: card.name,
          price: cardPrice.marketPrice,
          submittedBy: name,
        }]),
      });

      if (res.ok) {
        // Update dbMappings so "FIXED" status updates
        setDbMappings(prev => ({
          ...prev,
          [card.id]: {
            tcgProductId: cardPrice.tcgplayerProductId!,
            tcgUrl: cardPrice.tcgplayerUrl!,
            tcgName: card.name,
            price: cardPrice.marketPrice ?? null,
            artStyle: null,
            approved: true,
          }
        }));

        const newSession = sessionFixes + 1;
        setSessionFixes(newSession);
        showEncouragement(newSession);

        // If modal is open, advance to next
        if (selectedCard && selectedCard.id === card.id) {
          if (currentIndex < filteredCards.length - 1) {
            setTimeout(() => openCard(filteredCards[currentIndex + 1]), 800);
          } else {
            setSelectedCard(null);
          }
        }
      }
    } catch (error) {
      console.error('Failed to confirm:', error);
    } finally {
      setSaving(false);
    }
  };

  // Report a problem with a card
  const reportProblem = async () => {
    if (!selectedCard || saving || !problemReason.trim()) return;

    setSaving(true);
    const name = contributorName || 'Melody';

    try {
      const res = await fetch('/api/problems', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cardId: selectedCard.id,
          reason: problemReason.trim(),
          reportedBy: name,
        }),
      });

      if (res.ok) {
        setShowProblemInput(false);
        setProblemReason('');

        // Advance to next card
        if (currentIndex < filteredCards.length - 1) {
          setTimeout(() => openCard(filteredCards[currentIndex + 1]), 500);
        } else {
          setSelectedCard(null);
        }
      }
    } catch (error) {
      console.error('Failed to report problem:', error);
    } finally {
      setSaving(false);
    }
  };

  // Revert a fixed card mapping (delete from database)
  const revertMapping = async (card: CardWithPrice, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (saving) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/mappings/${encodeURIComponent(card.id)}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        // Remove from dbMappings
        setDbMappings(prev => {
          const updated = { ...prev };
          delete updated[card.id];
          return updated;
        });
      }
    } catch (error) {
      console.error('Failed to revert:', error);
    } finally {
      setSaving(false);
    }
  };

  // Handle paste in URL input - auto-save
  const handleUrlPaste = async (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pastedText = e.clipboardData.getData('text');
    if (pastedText.includes('tcgplayer.com/product/')) {
      e.preventDefault();
      const product = parseManualUrl(pastedText);
      if (product && selectedCard) {
        // Auto-save immediately
        assignProduct(product);
      }
    }
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
              <div className="text-2xl font-bold text-blue-400">{fixedCards.size}</div>
              <div className="text-xs text-zinc-500">In DB</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-yellow-400">{Object.keys(prices).length}</div>
              <div className="text-xs text-zinc-500">Prices</div>
            </div>
          </div>
        </div>

        {/* Floating Encouragement Overlay */}
        {encouragement && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none">
            <div className="p-6 bg-gradient-to-r from-pink-600 to-purple-600 rounded-2xl shadow-2xl animate-bounce">
              <span className="text-2xl font-bold text-white drop-shadow-lg">{encouragement}</span>
            </div>
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

        {/* Cards Grid - showing both our image and TCGPlayer side by side */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filteredCards.map(card => {
            const isFixed = fixedCards.has(card.id);
            const issue = cardIssues[card.id];
            const cardPrice = prices[card.id];
            const dbMapping = dbMappings[card.id];
            // Prefer db mapping (source of truth after fixing) over initial prices data
            const productId = dbMapping?.tcgProductId ?? cardPrice?.tcgplayerProductId;
            const marketPrice = dbMapping?.price ?? cardPrice?.marketPrice;

            return (
              <div
                key={card.id}
                onClick={() => openCard(card)}
                className={`cursor-pointer rounded-xl overflow-hidden border-2 transition-all hover:scale-[1.02] hover:shadow-xl ${
                  isFixed ? 'border-green-500 bg-green-500/5' :
                  issue?.isDuplicate ? 'border-red-500 bg-red-500/5' :
                  issue?.isUnmapped ? 'border-orange-500 bg-orange-500/5' :
                  'border-zinc-700 bg-zinc-900'
                }`}
              >
                {/* Card ID and status */}
                <div className="px-3 py-2 bg-zinc-800 flex items-center justify-between">
                  <span className="font-mono text-sm font-bold">{card.id}</span>
                  <div className="flex gap-1">
                    {isFixed && (
                      <span className="px-2 py-0.5 bg-green-600 rounded text-xs font-bold">FIXED</span>
                    )}
                    {issue?.isDuplicate && !isFixed && (
                      <span className="px-2 py-0.5 bg-red-600 rounded text-xs font-bold">DUP</span>
                    )}
                    {issue?.isUnmapped && !isFixed && (
                      <span className="px-2 py-0.5 bg-orange-600 rounded text-xs font-bold">NO LINK</span>
                    )}
                  </div>
                </div>

                {/* Two images side by side */}
                <div className="p-3 flex gap-3">
                  {/* Our image */}
                  <div className="flex-1">
                    <div className="text-[10px] font-bold text-green-400 mb-1 text-center">OURS</div>
                    <div className="aspect-[2.5/3.5] relative rounded-lg overflow-hidden bg-zinc-800 ring-2 ring-green-500">
                      <Image
                        src={card.imageUrl}
                        alt={card.name}
                        fill
                        className="object-cover"
                        unoptimized
                      />
                    </div>
                  </div>

                  {/* TCGPlayer image */}
                  <div className="flex-1">
                    <div className="text-[10px] font-bold text-yellow-400 mb-1 text-center">TCG</div>
                    {productId ? (
                      <div className={`aspect-[2.5/3.5] relative rounded-lg overflow-hidden bg-zinc-800 ring-2 ${isFixed ? 'ring-green-500' : 'ring-yellow-500'}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={getTcgplayerImageUrl(productId)}
                          alt="TCGPlayer"
                          className="absolute inset-0 w-full h-full object-contain"
                        />
                      </div>
                    ) : (
                      <div className="aspect-[2.5/3.5] rounded-lg bg-zinc-800 ring-2 ring-red-500 flex items-center justify-center">
                        <span className="text-zinc-500 text-xs">None</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Card name and price */}
                <div className="px-3 pb-2">
                  <div className="text-xs text-zinc-400 truncate">{card.name}</div>
                  <div className="text-sm font-bold mt-1">
                    {marketPrice != null && marketPrice !== undefined ? (
                      <span className="text-green-400">${Number(marketPrice).toFixed(2)}</span>
                    ) : (
                      <span className="text-zinc-600">No price</span>
                    )}
                  </div>
                </div>

                {/* Quick confirm button - only show if card has TCG mapping but not fixed */}
                {!isFixed && productId && (
                  <div className="px-3 pb-3">
                    <button
                      onClick={(e) => confirmLooksRight(card, e)}
                      disabled={saving}
                      className="w-full px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:bg-zinc-700 rounded text-xs font-bold transition-colors"
                    >
                      ✓ Looks Right
                    </button>
                  </div>
                )}

                {/* Revert button - only show for fixed cards */}
                {isFixed && (
                  <div className="px-3 pb-3">
                    <button
                      onClick={(e) => revertMapping(card, e)}
                      disabled={saving}
                      className="w-full px-3 py-1.5 bg-red-600/20 hover:bg-red-600 border border-red-500 disabled:bg-zinc-700 rounded text-xs font-bold transition-colors text-red-300 hover:text-white"
                    >
                      ↩ Revert
                    </button>
                  </div>
                )}
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

          {/* Jolly Roger Warning */}
          {!hideJollyRogerWarning && (selectedCard.setId === 'prb-01' || jollyRogerCards.has(selectedCard.baseId)) && (
            <div className="mx-4 mt-2 p-4 bg-purple-500/20 border border-purple-500 rounded-lg relative">
              <div className="absolute top-2 right-2 flex gap-2">
                <button
                  onClick={() => setShowJollyRogerExpanded(true)}
                  className="text-purple-400 hover:text-white text-sm px-2 py-1 rounded hover:bg-purple-500/30"
                >
                  🔍 Expand
                </button>
                <button
                  onClick={() => setHideJollyRogerWarning(true)}
                  className="text-purple-400 hover:text-white text-sm px-2 py-1 rounded hover:bg-purple-500/30"
                >
                  ✕ Hide
                </button>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-2xl">☠️</span>
                <div className="text-purple-200 text-sm flex-1">
                  {selectedCard.setId === 'prb-01' ? (
                    <strong className="text-purple-100">This COULD be a Jolly Roger Foil! Look for &quot;Jolly Roger Foil&quot; in the TCGPlayer product name.</strong>
                  ) : (
                    <strong className="text-purple-100">This card has a Jolly Roger Foil version! Check the borders carefully.</strong>
                  )}
                  <div className="mt-3 p-3 bg-zinc-900 rounded-lg cursor-pointer hover:bg-zinc-800" onClick={() => setShowJollyRogerExpanded(true)}>
                    <p className="text-xs text-zinc-400 mb-3">How to tell the difference - look at the WHITE BORDER on Jolly Roger: <span className="text-purple-400">(click to expand)</span></p>
                    <div className="flex justify-center gap-6">
                      <div className="text-center">
                        <p className="text-xs text-green-400 font-bold mb-2">✓ Regular Card</p>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src="https://product-images.tcgplayer.com/fit-in/200x279/454565.jpg"
                          alt="Regular card example"
                          className="w-24 h-auto rounded border-2 border-green-500"
                        />
                        <p className="text-[10px] text-zinc-500 mt-1">Colored border</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-purple-400 font-bold mb-2">☠️ Jolly Roger Foil</p>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src="https://product-images.tcgplayer.com/fit-in/200x279/586590.jpg"
                          alt="Jolly Roger Foil example"
                          className="w-24 h-auto rounded border-2 border-purple-500"
                        />
                        <p className="text-[10px] text-purple-300 mt-1">WHITE border</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Expanded Jolly Roger Comparison Modal */}
          {showJollyRogerExpanded && (
            <div
              className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center p-8"
              onClick={() => setShowJollyRogerExpanded(false)}
            >
              <div className="bg-zinc-900 rounded-2xl p-8 max-w-4xl" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl font-bold text-purple-300">☠️ Jolly Roger Foil vs Regular Card</h2>
                  <button
                    onClick={() => setShowJollyRogerExpanded(false)}
                    className="text-zinc-400 hover:text-white text-2xl"
                  >
                    ✕
                  </button>
                </div>
                <p className="text-zinc-300 mb-6 text-center">Look at the card borders - Jolly Roger Foils have a distinctive WHITE border!</p>
                <div className="flex justify-center gap-12">
                  <div className="text-center">
                    <p className="text-lg text-green-400 font-bold mb-4">✓ Regular Card</p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="https://product-images.tcgplayer.com/fit-in/400x558/454565.jpg"
                      alt="Regular card example"
                      className="w-64 h-auto rounded-lg border-4 border-green-500 shadow-xl"
                    />
                    <p className="text-sm text-zinc-400 mt-3">Colored border (matches card frame)</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg text-purple-400 font-bold mb-4">☠️ Jolly Roger Foil</p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="https://product-images.tcgplayer.com/fit-in/400x558/586590.jpg"
                      alt="Jolly Roger Foil example"
                      className="w-64 h-auto rounded-lg border-4 border-purple-500 shadow-xl"
                    />
                    <p className="text-sm text-purple-300 mt-3">WHITE border around the card</p>
                  </div>
                </div>
                <p className="text-center text-zinc-500 mt-6 text-sm">Click anywhere outside or the ✕ to close</p>
              </div>
            </div>
          )}

          {/* Action bar */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 bg-zinc-900/50">
            {/* Looks Right button */}
            {prices[selectedCard.id]?.tcgplayerProductId && !fixedCards.has(selectedCard.id) && (
              <button
                onClick={() => confirmLooksRight(selectedCard)}
                disabled={saving}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-zinc-700 rounded-lg font-bold transition-colors"
              >
                ✓ Looks Right
              </button>
            )}

            {/* Skip button */}
            <button
              onClick={() => {
                if (currentIndex < filteredCards.length - 1) {
                  openCard(filteredCards[currentIndex + 1]);
                } else {
                  setSelectedCard(null);
                }
              }}
              className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-sm text-zinc-300"
            >
              Skip
            </button>

            {/* Report Problem */}
            {!showProblemInput ? (
              <button
                onClick={() => setShowProblemInput(true)}
                className="px-4 py-2 bg-orange-600/20 hover:bg-orange-600/30 border border-orange-500 rounded-lg text-sm text-orange-300"
              >
                ⚠️ Report Problem
              </button>
            ) : (
              <div className="flex items-center gap-2 flex-1">
                <div className="flex flex-wrap gap-1">
                  {[...PRESET_REASONS, ...customProblemReasons].slice(0, 4).map((reason) => (
                    <button
                      key={reason}
                      onClick={() => {
                        setProblemReason(reason);
                        reportProblem();
                      }}
                      className="px-2 py-1 rounded text-xs font-medium bg-zinc-800 hover:bg-orange-600 text-zinc-300 hover:text-white transition-colors"
                    >
                      {reason}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={problemReason}
                  onChange={(e) => setProblemReason(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && problemReason.trim()) {
                      reportProblem();
                    }
                  }}
                  placeholder="Custom reason..."
                  className="w-40 px-2 py-1 bg-zinc-800 border border-zinc-600 rounded text-sm"
                />
                <button
                  onClick={() => {
                    setShowProblemInput(false);
                    setProblemReason('');
                  }}
                  className="px-2 py-1 text-zinc-400 hover:text-white"
                >
                  ✕
                </button>
              </div>
            )}

            {saving && (
              <span className="text-yellow-400 animate-pulse ml-auto">Saving...</span>
            )}

            {/* Paste URL input */}
            <div className="flex items-center gap-2 ml-auto">
              <a
                href={`https://www.google.com/search?q=${encodeURIComponent(selectedCard.baseId.replace(/_p\d+$/, ''))} tcgplayer one piece`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setTimeout(() => urlInputRef.current?.focus(), 100)}
                className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-sm transition-colors"
              >
                🔍 Google
              </a>
              <input
                ref={urlInputRef}
                type="text"
                placeholder="Paste TCGPlayer URL..."
                value={manualUrl}
                onChange={(e) => setManualUrl(e.target.value)}
                onPaste={handleUrlPaste}
                className="w-64 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm focus:ring-2 focus:ring-orange-500"
              />
            </div>
          </div>

          {/* Main content - unified grid */}
          <div className="flex-1 overflow-y-auto p-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {/* Our Image - first item */}
              <div className="p-3 rounded-lg border-4 border-green-500 bg-green-500/10">
                <div className="text-xs font-bold text-green-400 mb-2 text-center">OUR IMAGE</div>
                <div className="aspect-[2.5/3.5] relative rounded overflow-hidden bg-zinc-800">
                  <Image
                    src={selectedCard.imageUrl}
                    alt={selectedCard.name}
                    fill
                    className="object-cover"
                    unoptimized
                  />
                </div>
                <div className="text-sm font-mono text-center mt-2">{selectedCard.id}</div>
                {selectedCard.isParallel && (
                  <div className="text-center mt-1">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${
                      selectedCard.artStyle === 'manga' ? 'bg-pink-500 text-black' :
                      selectedCard.artStyle === 'wanted' ? 'bg-orange-500 text-black' :
                      'bg-amber-500 text-black'
                    }`}>
                      {selectedCard.artStyle === 'manga' ? 'MANGA' :
                       selectedCard.artStyle === 'wanted' ? 'WANTED' : 'ALT ART'}
                    </span>
                  </div>
                )}
              </div>

              {/* Current TCG Mapping - second item */}
              {(() => {
                const currentProductId = dbMappings[selectedCard.id]?.tcgProductId ?? prices[selectedCard.id]?.tcgplayerProductId;
                return (
                  <div className={`p-3 rounded-lg border-4 ${currentProductId ? 'border-yellow-500 bg-yellow-500/10' : 'border-red-500 bg-red-500/10'}`}>
                    <div className={`text-xs font-bold mb-2 text-center ${currentProductId ? 'text-yellow-400' : 'text-red-400'}`}>
                      CURRENT TCG
                    </div>
                    {currentProductId ? (
                      <>
                        <div className="aspect-[2.5/3.5] relative rounded overflow-hidden bg-zinc-800">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={getTcgplayerImageUrl(currentProductId)}
                            alt="Current TCG"
                            className="absolute inset-0 w-full h-full object-contain"
                          />
                        </div>
                        <div className="text-xs text-zinc-400 text-center mt-2">ID: {currentProductId}</div>
                      </>
                    ) : (
                      <div className="aspect-[2.5/3.5] rounded bg-zinc-800 flex items-center justify-center">
                        <span className="text-red-400 text-sm font-bold">NOT MAPPED</span>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* TCGPlayer Search Results */}
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
                    <div className="text-green-400 font-bold mt-1 text-sm">
                      ${product.marketPrice.toFixed(2)}
                    </div>
                  )}
                </div>
              ))}

              {/* Google Results - inline with TCG results */}
              {googleResults.map((product) => (
                <div
                  key={`google-${product.productId}`}
                  onClick={() => assignProduct(product)}
                  className="cursor-pointer p-3 rounded-lg border-2 border-blue-600 bg-zinc-800 hover:border-blue-500 hover:bg-blue-500/10 transition-all"
                >
                  <div className="text-[10px] font-bold text-blue-400 mb-1">GOOGLE</div>
                  <div className="aspect-[2.5/3.5] relative rounded overflow-hidden bg-zinc-700 mb-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={product.imageUrl}
                      alt={product.productName}
                      className="absolute inset-0 w-full h-full object-contain"
                    />
                  </div>
                  <div className="text-sm truncate">{product.productName}</div>
                </div>
              ))}

              {/* Loading state */}
              {searching && searchResults.length === 0 && (
                <div className="col-span-full text-center py-8 text-zinc-400">
                  Searching...
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
