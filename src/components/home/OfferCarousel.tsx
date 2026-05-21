"use client";

import { useRef, useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";

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

function variantLabel(o: Pick<EnrichedOffer, 'grading_company' | 'grade'>): string {
  if (!o.grading_company || !o.grade) return 'Raw NM';
  return `${o.grading_company} ${o.grade}`;
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
            return (
              <Link
                key={offer.id}
                href={`/card/${offer.card_id.toLowerCase()}`}
                className="w-[160px] sm:w-[180px] flex-shrink-0 group/card"
                style={{ scrollSnapAlign: "start" }}
              >
                <div className="relative aspect-[2.5/3.5] rounded-lg overflow-hidden bg-zinc-100 border border-zinc-200">
                  <Image
                    src={offer.cardImageUrl}
                    alt={offer.cardName}
                    fill
                    className="object-cover"
                    unoptimized
                  />
                  {/* Variant pill — green for graded slabs so they stand
                      out vs the more-common raw NM offers. */}
                  <span className={`absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                    isGraded
                      ? 'bg-emerald-500/95 text-white'
                      : 'bg-white/95 text-zinc-700 ring-1 ring-zinc-200'
                  }`}>
                    {variantLabel(offer)}
                  </span>
                </div>
                <div className="mt-2">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-emerald-700 font-semibold">
                    Top offer
                  </div>
                  <div className="text-lg font-semibold tabular-nums text-emerald-600 mt-0.5">
                    ${Number(offer.price).toFixed(2)}
                  </div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">
                    {timeAgo(offer.createdAt)}
                  </div>
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
