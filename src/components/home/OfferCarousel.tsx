"use client";

import { useRef, useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { gradingStyle } from "@/lib/gradingStyle";

export interface EnrichedOffer {
  id: string;
  card_id: string;
  cardName: string;
  cardImageUrl: string;
  price: number;
  grading_company: string | null;
  grade: string | null;
  createdAt: string;
}

interface OfferCarouselProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  offers: EnrichedOffer[];
  viewAllHref?: string;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}


/** Buyer-side discovery surface: a horizontal carousel of the highest
 *  active offers across the marketplace. Mirrors ListingCarousel's
 *  scroll mechanics — same arrow buttons, same scroll-snap, same tile
 *  size — so the home page's "Just Listed" (sell side) and "Top Offers"
 *  (buy side) sections feel like a matched pair. Click any tile to
 *  open the card page where the offer can be fulfilled. */
export function OfferCarousel({
  title,
  subtitle,
  icon,
  offers,
  viewAllHref,
}: OfferCarouselProps) {
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
    const cardWidth = 180 + 16;
    el.scrollBy({
      left: direction === "left" ? -cardWidth * 2 : cardWidth * 2,
      behavior: "smooth",
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            {icon}
            {title}
          </h2>
          {subtitle && (
            <p className="text-sm text-zinc-500 mt-1">{subtitle}</p>
          )}
        </div>
        {viewAllHref && (
          <Link
            href={viewAllHref}
            className="text-sm text-orange-500 hover:text-orange-600 transition-colors flex-shrink-0"
          >
            View all &rarr;
          </Link>
        )}
      </div>

      <div className="relative group">
        {canScrollLeft && (
          <button
            onClick={() => scroll("left")}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-white/90 border border-zinc-300 shadow-lg flex items-center justify-center text-zinc-900 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-zinc-100 -translate-x-2"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}

        {canScrollRight && (
          <button
            onClick={() => scroll("right")}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-white/90 border border-zinc-300 shadow-lg flex items-center justify-center text-zinc-900 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-zinc-100 translate-x-2"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}

        <div
          ref={scrollRef}
          className="flex gap-3 sm:gap-4 overflow-x-auto scrollbar-hide pb-2"
          style={{ scrollSnapType: "x mandatory" }}
        >
          {offers.map((offer) => {
            const isGraded = !!offer.grading_company;
            // Mirror the variant-pill treatment used in MarketTabs /
            // ConditionBadge so the same slab tier looks the same here.
            // Ungraded NM falls back to the neutral white-on-light chip.
            const style = isGraded
              ? gradingStyle(offer.grading_company, offer.grade)
              : null;
            return (
              <Link
                key={offer.id}
                href={`/card/${offer.card_id.toLowerCase()}`}
                className="w-[180px] sm:w-[200px] flex-shrink-0 group/card"
                style={{ scrollSnapAlign: "start" }}
              >
                {/* Bare card image — no overlays. The slab is already
                    visually busy; stacking a pill on top of it competes
                    with the art and reads as cramped. Variant info goes
                    below where it has room to breathe. */}
                <div className="relative aspect-[2.5/3.5] rounded-lg overflow-hidden bg-zinc-100 border border-zinc-200">
                  <Image
                    src={offer.cardImageUrl}
                    alt={offer.cardName}
                    fill
                    className="object-cover"
                    unoptimized
                  />
                </div>
                {/* Variant pill — its own row below the card so the
                    grade tier is the first thing the eye lands on after
                    the art, before the price. */}
                <div className="mt-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded ring-1 text-[10px] font-bold uppercase tracking-wider ${
                    style ? style.pill : 'bg-zinc-100 text-zinc-700 ring-zinc-200'
                  }`}>
                    {style ? style.shortLabel : 'Ungraded NM'}
                  </span>
                </div>
                <div className="mt-2">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500 font-semibold">
                    Top offer
                  </div>
                  <div className="text-xl font-bold tabular-nums text-zinc-900 mt-0.5">
                    ${Number(offer.price).toFixed(2)}
                  </div>
                  <div className="text-[11px] text-zinc-400 mt-1">
                    {timeAgo(offer.createdAt)}
                  </div>
                  <span className="mt-2.5 inline-flex w-full items-center justify-center px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider bg-emerald-600 text-white group-hover/card:bg-emerald-700 transition-colors">
                    Sell now
                  </span>
                </div>
                <span className="sr-only">{offer.cardName}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
