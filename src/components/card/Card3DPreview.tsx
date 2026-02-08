"use client";

import { useState, useRef } from "react";
import Image from "next/image";
import type { Card } from "@/types/card";
import { HolographicOverlay } from "./HolographicOverlay";

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

  const transform = `rotateX(${tilt.rotateX}deg) rotateY(${tilt.rotateY}deg) scale(${isHovering ? 1.02 : 1})`;

  return (
    <div className={`relative ${className}`}>
      <div
        ref={containerRef}
        className="relative w-full h-full"
        style={{ perspective: "1000px" }}
        onMouseMove={handleMouseMove}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div
          className="relative w-full h-full rounded-lg overflow-hidden"
          style={{
            transform,
            transition: isHovering ? "transform 0.1s ease-out" : "transform 0.3s ease-out",
          }}
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
      </div>
    </div>
  );
}
