"use client";

import { useState, useRef } from "react";
import Image from "next/image";
import type { Card } from "@/types/card";
import { HolographicOverlay } from "./HolographicOverlay";

interface CardThumbnailProps {
  card: Card;
}

export function CardThumbnail({ card }: CardThumbnailProps) {
  const containerRef = useRef<HTMLDivElement>(null);
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

    // Lighter tilt for thumbnails (10° vs 15° for detail view)
    const rotateY = clampedX * 10;
    const rotateX = -clampedY * 10;

    const glareX = ((clampedX + 1) / 2) * 100;
    const glareY = ((clampedY + 1) / 2) * 100;

    setTilt({ rotateX, rotateY, glareX, glareY });
  };

  const handleMouseEnter = () => setIsHovering(true);

  const handleMouseLeave = () => {
    setIsHovering(false);
    setTilt({ rotateX: 0, rotateY: 0, glareX: 50, glareY: 50 });
  };

  return (
    <div
      ref={containerRef}
      className="aspect-[2.5/3.5] relative rounded-lg overflow-hidden bg-zinc-900 dark:bg-zinc-900 light:bg-zinc-100"
      style={{ perspective: "600px" }}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div
        className="absolute inset-0"
        style={{
          transform: `rotateX(${tilt.rotateX}deg) rotateY(${tilt.rotateY}deg)`,
          transition: isHovering ? "transform 0.1s ease-out" : "transform 0.2s ease-out",
        }}
      >
        <Image
          src={card.imageUrl}
          alt={card.name}
          fill
          sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 20vw"
          className="object-cover"
          unoptimized
        />

        {/* Holographic effect for parallel cards */}
        {card.isParallel && isHovering && (
          <HolographicOverlay
            glareX={tilt.glareX}
            glareY={tilt.glareY}
            intensity={0.45}
          />
        )}
      </div>

    </div>
  );
}
