"use client";

import { useState, useRef } from "react";
import Image from "next/image";
import type { Card } from "@/types/card";
import { HolographicOverlay } from "./HolographicOverlay";
import { CardBack } from "./CardBack";

interface Card3DPreviewProps {
  card: Card;
  className?: string;
  priority?: boolean;
}

export function Card3DPreview({
  card,
  className = "",
  priority = false,
}: Card3DPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFlipped, setIsFlipped] = useState(false);
  const [tilt, setTilt] = useState({ rotateX: 0, rotateY: 0, glareX: 50, glareY: 50 });
  const [isHovering, setIsHovering] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const normalizedX = (e.clientX - centerX) / (rect.width / 2);
    const normalizedY = (e.clientY - centerY) / (rect.height / 2);

    const clampedX = Math.max(-1, Math.min(1, normalizedX));
    const clampedY = Math.max(-1, Math.min(1, normalizedY));

    const rotateY = clampedX * 15;
    const rotateX = -clampedY * 15;

    const glareX = ((clampedX + 1) / 2) * 100;
    const glareY = ((clampedY + 1) / 2) * 100;

    setTilt({ rotateX, rotateY, glareX, glareY });
  };

  const handleMouseEnter = () => setIsHovering(true);

  const handleMouseLeave = () => {
    setIsHovering(false);
    setTilt({ rotateX: 0, rotateY: 0, glareX: 50, glareY: 50 });
  };

  const transform = isFlipped
    ? `rotateX(${tilt.rotateX}deg) rotateY(${180 + tilt.rotateY}deg) scale(${isHovering ? 1.02 : 1})`
    : `rotateX(${tilt.rotateX}deg) rotateY(${tilt.rotateY}deg) scale(${isHovering ? 1.02 : 1})`;

  return (
    <div className={`relative ${className}`}>
      <div
        ref={containerRef}
        className="relative w-full h-full cursor-pointer"
        style={{ perspective: "1000px" }}
        onMouseMove={handleMouseMove}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div
          className="relative w-full h-full"
          style={{
            transformStyle: "preserve-3d",
            transform,
            transition: isHovering ? "transform 0.1s ease-out" : "transform 0.3s ease-out",
          }}
        >
          {/* Card Front */}
          <div
            className="absolute inset-0 rounded-lg overflow-hidden"
            style={{ backfaceVisibility: "hidden" }}
          >
            <Image
              src={card.imageUrl}
              alt={card.name}
              fill
              sizes="(max-width: 768px) 200px, 320px"
              className="object-contain"
              priority={priority}
              unoptimized
            />

            {card.isParallel && (
              <HolographicOverlay
                glareX={tilt.glareX}
                glareY={tilt.glareY}
                intensity={0.55}
              />
            )}
          </div>

          {/* Card Back */}
          <CardBack />
        </div>
      </div>

      {/* Controls */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 z-10">
        <button
          onClick={() => setIsFlipped(!isFlipped)}
          className="p-2 rounded-full bg-zinc-800/80 light:bg-zinc-200/80 hover:bg-zinc-700 light:hover:bg-zinc-300 transition-colors"
          aria-label="Flip card"
          title="Flip card"
        >
          <svg className="w-5 h-5 text-zinc-300 light:text-zinc-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>
    </div>
  );
}
