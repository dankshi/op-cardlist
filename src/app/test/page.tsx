"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Image from "next/image";
import type { Card, CardPrice } from "@/types/card";

interface CardWithPrice extends Card {
  price?: CardPrice;
}

interface CardMapping {
  cardId: string;
  tcgProductId: number;
  tcgUrl: string;
  tcgName: string;
  price?: number | null;
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
  "Amazing work, Melody! You're making this database so much better!",
  "You're on fire! Keep going, superstar!",
  "Melody, you're absolutely crushing it!",
  "Another one fixed! You're the best!",
  "Look at you go! The cards are so lucky to have you!",
  "Fantastic job! You're making such a difference!",
  "Melody's fixing machine! Unstoppable!",
  "Every fix makes the site better. Thank you, Melody!",
  "You're a card-fixing wizard!",
  "So proud of you! Keep being awesome!",
  "The One Piece community thanks you, Melody!",
  "You're doing incredible work!",
  "Another card saved! You're a hero!",
  "Melody = MVP of card fixing!",
  "That was a tricky one, but you got it!",
];

const MILESTONE_MESSAGES: Record<number, string> = {
  1: "You fixed your first card! Welcome to the team, Melody!",
  5: "5 cards fixed! You're getting the hang of this!",
  10: "Double digits! 10 cards fixed!",
  25: "25 cards! You're officially a pro!",
  50: "FIFTY cards! Melody, you're incredible!",
  100: "100 CARDS! You're a legend!",
  200: "200 cards?! Melody, you're unstoppable!",
  500: "500 CARDS! You deserve a trophy!",
};

export default function TestPage() {
  const [cards, setCards] = useState<CardWithPrice[]>([]);
  const [prices, setPrices] = useState<Record<string, CardPrice>>({});
  const [fixedCards, setFixedCards] = useState<Set<string>>(new Set());
  const [artStyleChanges, setArtStyleChanges] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<'all' | 'with-price' | 'has-variants' | 'mapped' | 'unmapped' | 'issues'>('issues');
  const [selectedSet, setSelectedSet] = useState<string>('all');
  const [sets, setSets] = useState<string[]>([]);

  // Modal state
  const [modalBaseId, setModalBaseId] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<TCGProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [manualUrl, setManualUrl] = useState('');
  const [saving, setSaving] = useState(false);

  // Which card we're currently assigning a product to
  const [activeCardId, setActiveCardId] = useState<string | null>(null);

  // Contributor tracking
  const [adminKey, setAdminKey] = useState<string>('');
  const [contributorName, setContributorName] = useState<string>('');
  const [sessionFixes, setSessionFixes] = useState(0);
  const [totalFixes, setTotalFixes] = useState(0);
  const [encouragement, setEncouragement] = useState<string | null>(null);

  useEffect(() => {
    // Load saved admin key and contributor name
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

    // Load fixed cards from this session
    const savedFixed = localStorage.getItem('fixed-cards');
    if (savedFixed) {
      setFixedCards(new Set(JSON.parse(savedFixed)));
    }
  }, []);

  // Toggle art style for a card
  const setCardArtStyle = (cardId: string, newArtStyle: string) => {
    const newChanges = { ...artStyleChanges, [cardId]: newArtStyle };
    setArtStyleChanges(newChanges);
    localStorage.setItem('artstyle-changes', JSON.stringify(newChanges));
  };

  // Cycle through art styles: alternate -> manga -> wanted -> alternate
  const cycleArtStyle = (cardId: string, currentArtStyle: string) => {
    const cycle: Record<string, string> = {
      'alternate': 'manga',
      'manga': 'wanted',
      'wanted': 'alternate',
      'standard': 'manga'
    };
    const newArtStyle = cycle[currentArtStyle] || 'manga';
    setCardArtStyle(cardId, newArtStyle);
  };

  // Get effective art style (considering pending changes)
  const getEffectiveArtStyle = (card: CardWithPrice): string => {
    return artStyleChanges[card.id] || card.artStyle || 'standard';
  };

  // Group cards by baseId
  const cardGroups = useMemo(() => {
    const groups: Record<string, CardWithPrice[]> = {};
    cards.forEach(card => {
      if (!groups[card.baseId]) {
        groups[card.baseId] = [];
      }
      groups[card.baseId].push(card);
    });
    Object.values(groups).forEach(group => {
      group.sort((a, b) => {
        if (!a.isParallel && b.isParallel) return -1;
        if (a.isParallel && !b.isParallel) return 1;
        return a.id.localeCompare(b.id);
      });
    });
    return groups;
  }, [cards]);

  // Detect duplicate TCGPlayer product IDs and unmapped cards
  const { duplicateProductIds, unmappedCardIds, cardIssues } = useMemo(() => {
    // Count how many cards use each product ID
    const productIdUsage: Record<number, string[]> = {};
    const unmapped: string[] = [];

    cards.forEach(card => {
      // Check prices for product ID
      const productId = prices[card.id]?.tcgplayerProductId;

      if (productId) {
        if (!productIdUsage[productId]) {
          productIdUsage[productId] = [];
        }
        productIdUsage[productId].push(card.id);
      } else {
        unmapped.push(card.id);
      }
    });

    // Find duplicates (product IDs used by more than one card)
    const duplicates: Record<number, string[]> = {};
    Object.entries(productIdUsage).forEach(([productId, cardIds]) => {
      if (cardIds.length > 1) {
        duplicates[parseInt(productId)] = cardIds;
      }
    });

    // Build a map of cardId -> issues
    const issues: Record<string, { isDuplicate: boolean; duplicateWith?: string[]; isUnmapped: boolean }> = {};

    Object.entries(duplicates).forEach(([productId, cardIds]) => {
      cardIds.forEach(cardId => {
        issues[cardId] = {
          isDuplicate: true,
          duplicateWith: cardIds.filter(id => id !== cardId),
          isUnmapped: false
        };
      });
    });

    unmapped.forEach(cardId => {
      if (!issues[cardId]) {
        issues[cardId] = { isDuplicate: false, isUnmapped: true };
      } else {
        issues[cardId].isUnmapped = true;
      }
    });

    return {
      duplicateProductIds: duplicates,
      unmappedCardIds: new Set(unmapped),
      cardIssues: issues
    };
  }, [cards, prices]);

  // Filter groups - when a set is selected, only show cards from that set within each group
  const filteredGroups = useMemo(() => {
    return Object.entries(cardGroups)
      .map(([baseId, group]): [string, CardWithPrice[]] => {
        // Filter cards within group by selected set
        if (selectedSet !== 'all') {
          const filteredCards = group.filter(c => c.setId === selectedSet);
          return [baseId, filteredCards];
        }
        return [baseId, group];
      })
      .filter(([, group]) => {
        // Remove empty groups
        if (group.length === 0) return false;

        const hasPrice = group.some(c => prices[c.id]?.tcgplayerUrl);
        const hasVariants = group.length > 1;
        const hasFixedCards = group.some(c => fixedCards.has(c.id));
        const needsMapping = hasVariants && group.some(c => !fixedCards.has(c.id) && !prices[c.id]?.tcgplayerProductId);
        const hasIssues = group.some(c => cardIssues[c.id]);

        switch (filter) {
          case 'with-price': return hasPrice;
          case 'has-variants': return hasVariants && hasPrice;
          case 'mapped': return hasFixedCards;
          case 'unmapped': return needsMapping;
          case 'issues': return hasIssues;
          default: return true;
        }
      })
      // Sort issues filter to show duplicates first, then unmapped
      .sort((a, b) => {
        if (filter !== 'issues') return 0;
        const aHasDupe = a[1].some(c => cardIssues[c.id]?.isDuplicate);
        const bHasDupe = b[1].some(c => cardIssues[c.id]?.isDuplicate);
        if (aHasDupe && !bHasDupe) return -1;
        if (!aHasDupe && bHasDupe) return 1;
        return 0;
      });
  }, [cardGroups, prices, fixedCards, filter, selectedSet, cardIssues]);

  // Navigation
  const currentIndex = modalBaseId ? filteredGroups.findIndex(([id]) => id === modalBaseId) : -1;

  const goToNext = useCallback(() => {
    if (currentIndex < filteredGroups.length - 1) {
      const nextBaseId = filteredGroups[currentIndex + 1][0];
      openModal(nextBaseId);
    }
  }, [currentIndex, filteredGroups]);

  const goToPrev = useCallback(() => {
    if (currentIndex > 0) {
      const prevBaseId = filteredGroups[currentIndex - 1][0];
      openModal(prevBaseId);
    }
  }, [currentIndex, filteredGroups]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!modalBaseId) return;
      if (e.key === 'ArrowRight' || e.key === 'n') goToNext();
      if (e.key === 'ArrowLeft' || e.key === 'p') goToPrev();
      if (e.key === 'Escape') closeModal();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modalBaseId, goToNext, goToPrev]);

  const openModal = async (baseId: string) => {
    setModalBaseId(baseId);
    setSearchResults([]);
    setSearching(true);
    setManualUrl('');
    setActiveCardId(null);

    const group = cardGroups[baseId];
    if (!group?.length) return;

    const card = group[0];
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

  const closeModal = () => {
    setModalBaseId(null);
    setSearchResults([]);
    setManualUrl('');
    setActiveCardId(null);
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

  // Show a random encouragement message
  const showEncouragement = (newTotal: number) => {
    // Check for milestone
    if (MILESTONE_MESSAGES[newTotal]) {
      setEncouragement(MILESTONE_MESSAGES[newTotal]);
    } else {
      // Random encouragement
      const msg = ENCOURAGEMENT_MESSAGES[Math.floor(Math.random() * ENCOURAGEMENT_MESSAGES.length)];
      setEncouragement(msg);
    }
    // Clear after 4 seconds
    setTimeout(() => setEncouragement(null), 4000);
  };

  const assignProductToCard = async (cardId: string, product: TCGProduct) => {
    if (saving) return;
    setSaving(true);
    setActiveCardId(null);

    const name = contributorName || 'Melody';
    const artStyle = artStyleChanges[cardId] || null;

    try {
      const res = await fetch('/api/mappings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(adminKey && { 'x-admin-key': adminKey }),
        },
        body: JSON.stringify([{
          cardId,
          tcgProductId: product.productId,
          tcgUrl: product.url,
          tcgName: product.productName,
          price: product.marketPrice,
          artStyle,
          submittedBy: name,
        }]),
      });

      if (res.ok) {
        // Update fixed cards
        const newFixed = new Set(fixedCards);
        newFixed.add(cardId);
        setFixedCards(newFixed);
        localStorage.setItem('fixed-cards', JSON.stringify([...newFixed]));

        // Update counts
        const newSession = sessionFixes + 1;
        const newTotal = totalFixes + 1;
        setSessionFixes(newSession);
        setTotalFixes(newTotal);
        localStorage.setItem('total-fixes', String(newTotal));

        // Show encouragement
        showEncouragement(newTotal);

        // Clear art style change if applied
        if (artStyle) {
          const newChanges = { ...artStyleChanges };
          delete newChanges[cardId];
          setArtStyleChanges(newChanges);
        }
      }
    } catch (error) {
      console.error('Failed to save:', error);
    } finally {
      setSaving(false);
    }
  };

  const removeMapping = (cardId: string) => {
    // Remove from fixed cards (local only - doesn't affect database)
    const newFixed = new Set(fixedCards);
    newFixed.delete(cardId);
    setFixedCards(newFixed);
    localStorage.setItem('fixed-cards', JSON.stringify([...newFixed]));
  };

  const clearSessionFixes = () => {
    if (confirm('Clear your session fix history? (Database entries remain)')) {
      setFixedCards(new Set());
      setSessionFixes(0);
      localStorage.removeItem('fixed-cards');
    }
  };

  const getTcgplayerImageUrl = (productId: number) => {
    return `https://product-images.tcgplayer.com/fit-in/400x558/${productId}.jpg`;
  };

  const getEffectiveProductId = (cardId: string): number | null => {
    return prices[cardId]?.tcgplayerProductId || null;
  };

  const isCardFixed = (cardId: string): boolean => {
    return fixedCards.has(cardId);
  };

  // Filter modal group by selected set
  const modalGroup = modalBaseId ? (
    selectedSet !== 'all'
      ? cardGroups[modalBaseId]?.filter(c => c.setId === selectedSet)
      : cardGroups[modalBaseId]
  ) : null;

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Fix TCGPlayer Links</h1>
          <div className="bg-blue-500/20 border border-blue-500/50 rounded-lg p-4 text-blue-200">
            <p className="text-lg font-medium mb-2">How this works:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li><strong>Our Image</strong> = The correct card from Bandai (this is what we have)</li>
              <li><strong>TCGPlayer</strong> = The price link we&apos;re using (this might be wrong for variants)</li>
              <li>Click &quot;Fix This&quot; to pick the correct TCGPlayer product that matches our image</li>
            </ol>
          </div>
        </div>

        {/* Encouragement Message */}
        {encouragement && (
          <div className="mb-6 p-6 bg-gradient-to-r from-pink-500/20 via-purple-500/20 to-blue-500/20 border-2 border-pink-400/50 rounded-xl animate-pulse">
            <p className="text-2xl font-bold text-center text-transparent bg-clip-text bg-gradient-to-r from-pink-400 via-purple-400 to-blue-400">
              {encouragement}
            </p>
          </div>
        )}

        {/* Fix Counter */}
        <div className="mb-6 p-4 bg-gradient-to-r from-green-500/10 to-blue-500/10 rounded-xl border border-green-500/30">
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-3">
              <input
                type="text"
                placeholder="Your name"
                value={contributorName}
                onChange={(e) => {
                  setContributorName(e.target.value);
                  localStorage.setItem('contributor-name', e.target.value);
                }}
                className="px-3 py-2 bg-zinc-900 border border-zinc-600 rounded-lg w-40"
              />
              <input
                type="password"
                placeholder="Admin key"
                value={adminKey}
                onChange={(e) => {
                  setAdminKey(e.target.value);
                  localStorage.setItem('admin-key', e.target.value);
                }}
                className="px-3 py-2 bg-zinc-900 border border-zinc-600 rounded-lg w-32"
              />
            </div>
            <div className="flex items-center gap-4">
              <div className="text-center">
                <div className="text-3xl font-bold text-green-400">{sessionFixes}</div>
                <div className="text-xs text-zinc-400">This Session</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-blue-400">{totalFixes}</div>
                <div className="text-xs text-zinc-400">All Time</div>
              </div>
            </div>
            {saving && (
              <div className="px-4 py-2 bg-yellow-500/20 text-yellow-300 rounded-lg animate-pulse">
                Saving...
              </div>
            )}
          </div>
        </div>

        {/* Issue Summary */}
        {Object.keys(cardIssues).length > 0 && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
            <h3 className="text-lg font-bold text-red-400 mb-2">⚠️ Issues Found</h3>
            <div className="flex gap-6 text-sm">
              <div>
                <span className="text-red-300 font-bold">{Object.keys(duplicateProductIds).length}</span>
                <span className="text-zinc-400 ml-1">duplicate TCG links</span>
                <span className="text-zinc-500 ml-1">({Object.values(duplicateProductIds).flat().length} cards affected)</span>
              </div>
              <div>
                <span className="text-orange-300 font-bold">{unmappedCardIds.size}</span>
                <span className="text-zinc-400 ml-1">unmapped cards</span>
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-4 mb-8 items-end">
          <div>
            <label className="text-sm text-zinc-400 block mb-2">Show</label>
            <div className="flex gap-2">
              {(['issues', 'has-variants', 'mapped', 'all'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-4 py-2 rounded-lg font-medium ${
                    filter === f
                      ? f === 'issues' ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'
                      : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                  }`}
                >
                  {f === 'issues' ? `⚠️ Issues (${Object.keys(cardIssues).length})` :
                   f === 'has-variants' ? 'Cards with Variants' :
                   f === 'mapped' ? `My Fixes (${fixedCards.size})` :
                   'All Cards'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm text-zinc-400 block mb-2">Set</label>
            <select
              value={selectedSet}
              onChange={(e) => setSelectedSet(e.target.value)}
              className="px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-lg"
            >
              <option value="all">All Sets</option>
              {sets.map(s => (
                <option key={s} value={s}>{s.toUpperCase()}</option>
              ))}
            </select>
          </div>

          <div className="text-zinc-500 ml-auto">
            {filteredGroups.length} card groups
          </div>
        </div>

        {/* Card Groups - Main List */}
        <div className="space-y-4">
          {filteredGroups.map(([baseId, group]) => {
            const hasAnyFixed = group.some(c => fixedCards.has(c.id));
            const groupHasDuplicate = group.some(c => cardIssues[c.id]?.isDuplicate);
            const groupHasUnmapped = group.some(c => cardIssues[c.id]?.isUnmapped);

            return (
              <div
                key={baseId}
                className={`p-6 rounded-xl border-2 ${
                  hasAnyFixed ? 'border-green-500 bg-green-500/5' :
                  groupHasDuplicate ? 'border-red-500 bg-red-500/5' :
                  groupHasUnmapped ? 'border-orange-500 bg-orange-500/5' :
                  'border-zinc-700 bg-zinc-900'
                }`}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-4 flex-wrap">
                    <span className="text-2xl font-mono font-bold text-blue-400">{baseId}</span>
                    <span className="text-xl text-zinc-300">{group[0].name}</span>
                    <span className="px-3 py-1 bg-zinc-700 rounded-full text-sm">
                      {group.length} version{group.length > 1 ? 's' : ''}
                    </span>
                    {hasAnyFixed && (
                      <span className="px-3 py-1 bg-green-600 rounded-full text-sm font-medium">
                        FIXED
                      </span>
                    )}
                    {groupHasDuplicate && (
                      <span className="px-3 py-1 bg-red-600 rounded-full text-sm font-medium">
                        ⚠️ DUPLICATE TCG LINK
                      </span>
                    )}
                    {groupHasUnmapped && !groupHasDuplicate && (
                      <span className="px-3 py-1 bg-orange-600 rounded-full text-sm font-medium">
                        NEEDS MAPPING
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => openModal(baseId)}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium text-lg"
                  >
                    Fix Mappings
                  </button>
                </div>

                {/* Cards preview - larger */}
                <div className="flex gap-6 overflow-x-auto pb-2">
                  {group.map(card => {
                    const productId = getEffectiveProductId(card.id);
                    const isFixed = fixedCards.has(card.id);
                    const price = prices[card.id];
                    const issue = cardIssues[card.id];

                    return (
                      <div key={card.id} className="shrink-0">
                        <div className="text-sm font-mono text-zinc-400 mb-2 flex items-center gap-2 flex-wrap">
                          <span className="font-bold">{card.id}</span>
                          {card.isParallel && (
                            <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                              card.artStyle === 'manga' ? 'bg-pink-500 text-black' :
                              card.artStyle === 'wanted' ? 'bg-orange-500 text-black' :
                              'bg-amber-500 text-black'
                            }`}>
                              {card.artStyle === 'manga' ? 'MANGA' :
                               card.artStyle === 'wanted' ? 'WANTED' : 'ALT ART'}
                            </span>
                          )}
                          {isFixed && <span className="px-2 py-0.5 bg-green-600 rounded text-xs font-bold">FIXED</span>}
                          {issue?.isDuplicate && (
                            <span className="px-2 py-0.5 bg-red-600 rounded text-xs font-bold" title={`Same TCG link as: ${issue.duplicateWith?.join(', ')}`}>
                              DUPLICATE
                            </span>
                          )}
                          {issue?.isUnmapped && (
                            <span className="px-2 py-0.5 bg-orange-600 rounded text-xs font-bold">
                              UNMAPPED
                            </span>
                          )}
                        </div>

                        <div className="flex gap-3">
                          {/* Our image - THE CORRECT ONE */}
                          <div>
                            <div className="text-xs font-bold text-green-400 mb-1 text-center">OUR IMAGE</div>
                            <div className="w-32 aspect-[2.5/3.5] relative rounded-lg overflow-hidden bg-zinc-800 ring-2 ring-green-500">
                              <Image
                                src={card.imageUrl}
                                alt={card.name}
                                fill
                                className="object-cover"
                                unoptimized
                              />
                            </div>
                          </div>

                          {/* TCGPlayer image - MIGHT BE WRONG */}
                          <div>
                            <div className="text-xs font-bold text-yellow-400 mb-1 text-center">TCGPLAYER</div>
                            {productId ? (
                              <div className={`w-32 aspect-[2.5/3.5] relative rounded-lg overflow-hidden bg-zinc-800 ring-2 ${isFixed ? 'ring-green-500' : 'ring-yellow-500'}`}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={getTcgplayerImageUrl(productId)}
                                  alt="TCGPlayer"
                                  className="absolute inset-0 w-full h-full object-contain"
                                />
                              </div>
                            ) : (
                              <div className="w-32 aspect-[2.5/3.5] rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-500 ring-2 ring-red-500">
                                No Link
                              </div>
                            )}
                          </div>
                        </div>

                        {price?.marketPrice && (
                          <div className="text-center mt-2 text-lg font-bold text-green-400">
                            ${price.marketPrice.toFixed(2)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {filteredGroups.length === 0 && (
          <div className="text-center py-16 text-zinc-500 text-xl">
            No cards found matching filters
          </div>
        )}
      </div>

      {/* Mapping Modal - BIGGER AND CLEARER */}
      {modalGroup && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4 overflow-auto">
          <div className="bg-zinc-900 rounded-2xl max-w-7xl w-full max-h-[95vh] overflow-hidden flex flex-col">
            {/* Header with navigation */}
            <div className="p-6 border-b border-zinc-700 flex items-center justify-between bg-zinc-800">
              <button
                onClick={goToPrev}
                disabled={currentIndex <= 0}
                className="px-6 py-3 bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:text-zinc-600 rounded-lg text-lg font-medium"
              >
                ← Previous
              </button>
              <div className="text-center">
                <h2 className="text-2xl font-bold">
                  <span className="text-blue-400 font-mono">{modalBaseId}</span>
                  <span className="text-zinc-300 ml-3">{modalGroup[0].name}</span>
                </h2>
                <p className="text-zinc-400 mt-1">
                  Card {currentIndex + 1} of {filteredGroups.length}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={goToNext}
                  disabled={currentIndex >= filteredGroups.length - 1}
                  className="px-6 py-3 bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:text-zinc-600 rounded-lg text-lg font-medium"
                >
                  Next →
                </button>
                <button
                  onClick={closeModal}
                  className="px-4 py-3 bg-red-600/30 hover:bg-red-600/50 text-red-300 rounded-lg text-lg"
                >
                  Close
                </button>
              </div>
            </div>

            {/* Instructions */}
            <div className="px-6 py-4 bg-yellow-500/10 border-b border-yellow-500/30">
              <p className="text-yellow-200 text-lg">
                <strong>Step 1:</strong> Click &quot;Select&quot; on the card you want to fix →
                <strong> Step 2:</strong> Click the matching TCGPlayer product below
              </p>
            </div>

            {/* OUR CARDS - What we have */}
            <div className="p-6 border-b border-zinc-700">
              <h3 className="text-xl font-bold text-green-400 mb-4 flex items-center gap-2">
                <span className="w-4 h-4 bg-green-500 rounded-full"></span>
                OUR CARD IMAGES (These are correct - from Bandai)
              </h3>
              <div className="flex gap-6 overflow-x-auto pb-2">
                {modalGroup.map(card => {
                  const isFixed = fixedCards.has(card.id);
                  const currentProductId = getEffectiveProductId(card.id);
                  const isActive = activeCardId === card.id;

                  return (
                    <div
                      key={card.id}
                      className={`shrink-0 p-4 rounded-xl border-3 transition-all ${
                        isActive
                          ? 'border-blue-500 bg-blue-500/20 ring-4 ring-blue-500/50'
                          : isFixed
                          ? 'border-green-500 bg-green-500/10'
                          : 'border-zinc-600 bg-zinc-800 hover:border-zinc-400'
                      }`}
                    >
                      {/* Card ID and Type */}
                      <div className="text-center mb-3">
                        <div className="text-lg font-mono font-bold">{card.id}</div>
                        {card.isParallel && (() => {
                          const effectiveStyle = getEffectiveArtStyle(card);
                          const hasChange = artStyleChanges[card.id];
                          return (
                            <span className={`inline-block mt-1 px-3 py-1 rounded text-sm font-bold ${
                              effectiveStyle === 'manga' ? 'bg-pink-500 text-black' :
                              effectiveStyle === 'wanted' ? 'bg-orange-500 text-black' :
                              'bg-amber-500 text-black'
                            } ${hasChange ? 'ring-2 ring-white' : ''}`}>
                              {effectiveStyle === 'manga' ? 'MANGA VERSION' :
                               effectiveStyle === 'wanted' ? 'WANTED POSTER' : 'ALTERNATE ART'}
                              {hasChange && ' (changed)'}
                            </span>
                          );
                        })()}
                        {!card.isParallel && (
                          <span className="inline-block mt-1 px-3 py-1 rounded text-sm font-bold bg-zinc-600">
                            STANDARD
                          </span>
                        )}
                      </div>

                      {/* Images side by side */}
                      <div className="flex gap-4 items-start">
                        {/* Our image */}
                        <div>
                          <div className="text-xs font-bold text-green-400 mb-1 text-center">OUR IMAGE</div>
                          <div className="w-40 aspect-[2.5/3.5] relative rounded-lg overflow-hidden bg-zinc-700 ring-2 ring-green-500">
                            <Image
                              src={card.imageUrl}
                              alt={card.name}
                              fill
                              className="object-cover"
                              unoptimized
                            />
                          </div>
                        </div>

                        <div className="text-3xl text-zinc-500 self-center">=</div>

                        {/* Current TCGPlayer */}
                        <div>
                          <div className="text-xs font-bold text-yellow-400 mb-1 text-center">
                            {isFixed ? 'FIXED!' : 'CURRENT TCG'}
                          </div>
                          {currentProductId ? (
                            <div className={`w-40 aspect-[2.5/3.5] relative rounded-lg overflow-hidden bg-zinc-700 ring-2 ${isFixed ? 'ring-green-500' : 'ring-yellow-500'}`}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={getTcgplayerImageUrl(currentProductId)}
                                alt="TCGPlayer"
                                className="absolute inset-0 w-full h-full object-contain"
                              />
                            </div>
                          ) : (
                            <div className="w-40 aspect-[2.5/3.5] rounded-lg bg-zinc-700 flex items-center justify-center text-zinc-400 ring-2 ring-red-500">
                              No TCG Link
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="mt-4 space-y-2">
                        {isFixed ? (
                          <div className="text-sm text-green-400 text-center font-medium py-3">
                            ✓ Fixed this session!
                          </div>
                        ) : (
                          <button
                            onClick={() => setActiveCardId(isActive ? null : card.id)}
                            disabled={saving}
                            className={`w-full py-3 rounded-lg font-bold text-lg ${
                              isActive
                                ? 'bg-blue-600 text-white'
                                : 'bg-yellow-600 hover:bg-yellow-500 text-black disabled:opacity-50'
                            }`}
                          >
                            {saving ? 'Saving...' : isActive ? 'Now click a product below ↓' : 'Select to Fix This'}
                          </button>
                        )}

                        {/* Art style toggles - only for parallel cards */}
                        {card.isParallel && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => setCardArtStyle(card.id, getEffectiveArtStyle(card) === 'manga' ? 'alternate' : 'manga')}
                              className={`flex-1 py-2 rounded-lg font-medium text-sm ${
                                getEffectiveArtStyle(card) === 'manga'
                                  ? 'bg-pink-600 hover:bg-pink-500 text-white'
                                  : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300'
                              }`}
                            >
                              {getEffectiveArtStyle(card) === 'manga' ? '✓ Manga' : 'Manga'}
                            </button>
                            <button
                              onClick={() => setCardArtStyle(card.id, getEffectiveArtStyle(card) === 'wanted' ? 'alternate' : 'wanted')}
                              className={`flex-1 py-2 rounded-lg font-medium text-sm ${
                                getEffectiveArtStyle(card) === 'wanted'
                                  ? 'bg-orange-600 hover:bg-orange-500 text-white'
                                  : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300'
                              }`}
                            >
                              {getEffectiveArtStyle(card) === 'wanted' ? '✓ Wanted' : 'Wanted'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Manual URL input */}
            <div className="px-6 py-4 border-b border-zinc-700 bg-zinc-800/50">
              <div className="flex gap-3">
                <input
                  type="text"
                  placeholder="Paste TCGPlayer URL here to add a product..."
                  value={manualUrl}
                  onChange={(e) => setManualUrl(e.target.value)}
                  className="flex-1 px-4 py-3 bg-zinc-900 border border-zinc-600 rounded-lg text-lg"
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
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 rounded-lg font-medium"
                >
                  Add Product
                </button>
              </div>
            </div>

            {/* TCGPLAYER PRODUCTS - Pick the right one */}
            <div className="flex-1 overflow-y-auto p-6">
              <h3 className="text-xl font-bold text-yellow-400 mb-4 flex items-center gap-2">
                <span className="w-4 h-4 bg-yellow-500 rounded-full"></span>
                TCGPLAYER PRODUCTS
                {activeCardId && (
                  <span className="text-blue-400 ml-2">
                    — Click one to assign to {activeCardId}
                  </span>
                )}
              </h3>

              {searching ? (
                <div className="text-center py-12 text-zinc-400 text-xl">
                  Searching TCGPlayer...
                </div>
              ) : searchResults.length === 0 ? (
                <div className="text-center py-12 text-zinc-400 text-xl">
                  No products found. Try pasting a TCGPlayer URL above.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {searchResults.map((product) => {
                    return (
                      <div
                        key={product.productId}
                        onClick={() => {
                          if (activeCardId && !saving) {
                            assignProductToCard(activeCardId, product);
                          }
                        }}
                        className={`p-3 rounded-xl border-2 transition-all ${
                          activeCardId && !saving
                            ? 'cursor-pointer hover:border-blue-500 hover:bg-blue-500/10'
                            : 'cursor-default'
                        } border-zinc-700 bg-zinc-800`}
                      >
                        <div className="aspect-[2.5/3.5] relative rounded-lg overflow-hidden bg-zinc-700 mb-3">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={product.imageUrl}
                            alt={product.productName}
                            className="absolute inset-0 w-full h-full object-contain"
                          />
                        </div>
                        <div className="text-sm font-mono text-zinc-400">{product.number}</div>
                        <div className="text-sm text-zinc-200 line-clamp-2 font-medium">{product.productName}</div>
                        {product.marketPrice && (
                          <div className="text-lg font-bold text-green-400 mt-1">
                            ${product.marketPrice.toFixed(2)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
