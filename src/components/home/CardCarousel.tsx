"use client";

import { useRef, useState, useEffect } from "react";
import Link from "next/link";
import type { Card } from "@/types/card";
import { CardThumbnail } from "../card/CardThumbnail";
import { PriceChangeBadge } from "../PriceChangeBadge";

interface CardCarouselProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  cards: Card[];
  showPriceChange?: boolean;
  priceChanges?: Record<string, number>;
  viewAllHref?: string;
}

export function CardCarousel({
  title,
  subtitle,
  icon,
  cards,
  showPriceChange,
  priceChanges,
  viewAllHref,
}: CardCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const updateScrollState = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener("scroll", updateScrollState, { passive: true });
    return () => el.removeEventListener("scroll", updateScrollState);
  }, []);

  const scroll = (direction: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    const cardWidth = 180 + 16; // card width + gap
    el.scrollBy({
      left: direction === "left" ? -cardWidth * 2 : cardWidth * 2,
      behavior: "smooth",
    });
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            {icon}
            {title}
          </h2>
          {subtitle && (
            <p className="text-sm text-zinc-400 light:text-zinc-600 mt-1">
              {subtitle}
            </p>
          )}
        </div>
        {viewAllHref && (
          <Link
            href={viewAllHref}
            className="text-sm text-sky-500 light:text-sky-600 hover:text-sky-400 light:hover:text-sky-700 transition-colors flex-shrink-0"
          >
            View all &rarr;
          </Link>
        )}
      </div>

      {/* Carousel */}
      <div className="relative group">
        {/* Left arrow */}
        {canScrollLeft && (
          <button
            onClick={() => scroll("left")}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-zinc-800/90 light:bg-white/90 border border-zinc-700 light:border-zinc-300 shadow-lg flex items-center justify-center text-white light:text-zinc-900 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-zinc-700 light:hover:bg-zinc-100 -translate-x-2"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}

        {/* Right arrow */}
        {canScrollRight && (
          <button
            onClick={() => scroll("right")}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-zinc-800/90 light:bg-white/90 border border-zinc-700 light:border-zinc-300 shadow-lg flex items-center justify-center text-white light:text-zinc-900 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-zinc-700 light:hover:bg-zinc-100 translate-x-2"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}

        {/* Scrollable track */}
        <div
          ref={scrollRef}
          className="flex gap-3 sm:gap-4 overflow-x-auto scrollbar-hide pb-2"
          style={{ scrollSnapType: "x mandatory" }}
        >
          {cards.map((card) => (
            <Link
              key={card.id}
              href={`/card/${card.id.toLowerCase()}`}
              className="w-[140px] sm:w-[160px] lg:w-[180px] flex-shrink-0 group/card"
              style={{ scrollSnapAlign: "start" }}
            >
              <CardThumbnail card={card} />
              <div className="mt-2">
                <p className="text-sm font-medium truncate group-hover/card:text-sky-500 transition-colors">
                  {card.name}
                </p>
                <p className="text-xs text-zinc-500">{card.id}</p>
                {showPriceChange && priceChanges?.[card.id] != null && (
                  <div className="mt-1">
                    <PriceChangeBadge
                      changePercent={priceChanges[card.id]}
                      size="sm"
                    />
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
