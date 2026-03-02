"use client";

import { useRef, useState, useEffect } from "react";
import Link from "next/link";
import { ConditionBadge } from "../marketplace/ConditionBadge";
import type { CardCondition } from "@/types/database";

export interface EnrichedListing {
  id: string;
  card_id: string;
  cardName: string;
  cardImageUrl: string;
  price: number;
  condition: CardCondition;
  grading_company?: string | null;
  grade?: string | null;
  createdAt: string;
}

interface ListingCarouselProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  listings: EnrichedListing[];
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

export function ListingCarousel({
  title,
  subtitle,
  icon,
  listings,
  viewAllHref,
}: ListingCarouselProps) {
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
      {/* Header */}
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

      {/* Carousel */}
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
          {listings.map((listing) => (
            <Link
              key={listing.id}
              href={`/card/${listing.card_id.toLowerCase()}`}
              className="w-[160px] sm:w-[180px] flex-shrink-0 group/card"
              style={{ scrollSnapAlign: "start" }}
            >
              <div className="relative aspect-[2.5/3.5] rounded-lg overflow-hidden bg-zinc-100 border border-zinc-200">
                <img
                  src={listing.cardImageUrl}
                  alt={listing.cardName}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
              <div className="mt-2">
                <p className="text-sm font-medium truncate group-hover/card:text-orange-500 transition-colors">
                  {listing.cardName}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-sm font-bold text-zinc-900">
                    ${Number(listing.price).toFixed(2)}
                  </span>
                  <ConditionBadge condition={listing.condition} gradingCompany={listing.grading_company} grade={listing.grade} />
                </div>
                <p className="text-xs text-zinc-400 mt-1">
                  {timeAgo(listing.createdAt)}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
