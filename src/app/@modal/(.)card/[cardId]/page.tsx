"use client";

import { useRouter } from "next/navigation";
import { useEffect, useCallback, useState } from "react";
import { getCardById } from "@/lib/cards";
import type { Card } from "@/types/card";
import { use } from "react";
import { Card3DPreview } from "@/components/card/Card3DPreview";
import { ShareButtons } from "@/components/ShareButtons";

interface PageProps {
  params: Promise<{ cardId: string }>;
}

const colorClasses: Record<string, string> = {
  Red: "bg-red-500",
  Green: "bg-green-500",
  Blue: "bg-blue-500",
  Purple: "bg-purple-500",
  Black: "bg-zinc-600",
  Yellow: "bg-yellow-500",
};

export default function CardModal({ params }: PageProps) {
  const { cardId } = use(params);
  const [card, setCard] = useState<Card | null>(null);
  const router = useRouter();

  useEffect(() => {
    const foundCard = getCardById(cardId.toUpperCase());
    setCard(foundCard ?? null);
  }, [cardId]);

  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [handleClose]);

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  if (!card) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 bg-black/90 light:bg-black/60 z-50 flex items-center justify-center p-4 md:p-6 lg:p-8"
      onClick={handleBackdropClick}
    >
      {/* Modal Container */}
      <div className="relative w-full max-w-5xl bg-zinc-900 light:bg-white rounded-2xl border border-zinc-800 light:border-zinc-200 overflow-hidden shadow-2xl">
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-3 right-3 z-10 p-2 rounded-full bg-zinc-800/80 light:bg-zinc-200/80 hover:bg-zinc-700 light:hover:bg-zinc-300 transition-colors group"
          aria-label="Close"
        >
          <svg
            className="w-5 h-5 text-zinc-400 light:text-zinc-600 group-hover:text-white light:group-hover:text-zinc-900 transition-colors"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>

        <div className="flex flex-col md:flex-row max-h-[90vh]">
          {/* Card Image - Left Side with 3D Preview */}
          <div className="flex-shrink-0 bg-zinc-950 light:bg-zinc-100 p-4 md:p-6 flex items-center justify-center md:w-[340px] lg:w-[400px]">
            <Card3DPreview
              card={card}
              className="w-[200px] h-[280px] md:w-[280px] md:h-[392px] lg:w-[320px] lg:h-[448px]"
              priority
            />
          </div>

          {/* Card Details - Right Side */}
          <div className="flex-1 p-5 md:p-6 overflow-y-auto">
            {/* Header Row */}
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-zinc-400 light:text-zinc-600 font-mono">{card.id}</span>
                  <span className="px-2 py-0.5 bg-zinc-800 light:bg-zinc-200 rounded text-xs font-medium">{card.rarity}</span>
                  <span className="px-2 py-0.5 bg-zinc-800 light:bg-zinc-200 rounded text-xs">{card.type}</span>
                  {card.isParallel && (
                    <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded text-xs font-medium">
                      {card.artStyle === 'wanted' ? 'WANTED' : card.artStyle === 'manga' ? 'MANGA' : 'ALT'}
                    </span>
                  )}
                </div>
                <h1 className="text-2xl md:text-3xl font-bold">{card.name}</h1>
              </div>
            </div>

            {/* Colors */}
            <div className="flex items-center gap-2 mb-4">
              {card.colors.map((color) => (
                <div key={color} className="flex items-center gap-1.5">
                  <span className={`w-4 h-4 rounded-full ${colorClasses[color]}`} />
                  <span className="text-sm text-zinc-400 light:text-zinc-600">{color}</span>
                </div>
              ))}
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-4 gap-3 mb-5">
              <div className="bg-zinc-800/50 light:bg-zinc-100 rounded-lg p-3 text-center">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wide">{card.type === "LEADER" ? "Life" : "Cost"}</p>
                <p className="text-xl font-bold">{card.type === "LEADER" ? (card.life ?? "-") : (card.cost ?? "-")}</p>
              </div>
              <div className="bg-zinc-800/50 light:bg-zinc-100 rounded-lg p-3 text-center">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Power</p>
                <p className="text-xl font-bold">{card.power?.toLocaleString() ?? "-"}</p>
              </div>
              <div className="bg-zinc-800/50 light:bg-zinc-100 rounded-lg p-3 text-center">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Counter</p>
                <p className="text-xl font-bold">{card.counter ? `+${card.counter.toLocaleString()}` : "-"}</p>
              </div>
              <div className="bg-zinc-800/50 light:bg-zinc-100 rounded-lg p-3 text-center">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Attribute</p>
                <p className="text-lg font-bold truncate">{card.attribute ?? "-"}</p>
              </div>
            </div>

            {/* Traits */}
            {card.traits.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {card.traits.map((trait) => (
                  <span key={trait} className="px-2.5 py-1 bg-zinc-800 light:bg-zinc-200 rounded-full text-xs text-zinc-300 light:text-zinc-700">
                    {trait}
                  </span>
                ))}
              </div>
            )}

            {/* Effect */}
            <div className="mb-4">
              <h3 className="text-xs text-zinc-500 uppercase tracking-wide mb-2">Effect</h3>
              <p className="text-sm text-zinc-300 light:text-zinc-700 leading-relaxed">
                {card.effect || "No effect."}
              </p>
            </div>

            {/* Trigger */}
            {card.trigger && (
              <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <h3 className="text-xs text-amber-400 uppercase tracking-wide mb-1">Trigger</h3>
                <p className="text-sm text-zinc-300 light:text-zinc-700">{card.trigger}</p>
              </div>
            )}

            {/* Price */}
            {card.price?.marketPrice != null && (
              <div className="mb-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                <h3 className="text-xs text-green-400 uppercase tracking-wide mb-1">TCGPlayer Price</h3>
                <div className="flex items-center justify-between">
                  <span className="text-xl font-bold text-green-400">${card.price.marketPrice.toFixed(2)}</span>
                  {card.price.tcgplayerUrl && (
                    <a
                      href={card.price.tcgplayerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-green-400 hover:text-green-300 underline"
                    >
                      View on TCGPlayer
                    </a>
                  )}
                </div>
                {(card.price.lowPrice != null || card.price.highPrice != null) && (
                  <p className="text-xs text-zinc-500 mt-1">
                    {card.price.lowPrice != null && `Low: $${card.price.lowPrice.toFixed(2)}`}
                    {card.price.lowPrice != null && card.price.highPrice != null && ' • '}
                    {card.price.highPrice != null && `High: $${card.price.highPrice.toFixed(2)}`}
                  </p>
                )}
              </div>
            )}

            {/* Share Buttons */}
            <div className="mb-4">
              <ShareButtons card={card} />
            </div>

            {/* Set Info */}
            <div className="mt-4 pt-4 border-t border-zinc-800 light:border-zinc-200">
              <p className="text-xs text-zinc-500">
                Set: <span className="text-zinc-300 light:text-zinc-700 font-medium">{card.setId.toUpperCase()}</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
