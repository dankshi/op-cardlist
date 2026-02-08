"use client";

import { useState, useCallback, useRef, RefObject } from "react";

export interface MouseTiltResult {
  rotateX: number;
  rotateY: number;
  glareX: number;
  glareY: number;
  isHovering: boolean;
  scale: number;
  ref: RefObject<HTMLDivElement | null>;
  handlers: {
    onMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
  };
}

interface UseMouseTiltOptions {
  maxTilt?: number;
  hoverScale?: number;
  disabled?: boolean;
}

export function useMouseTilt(options: UseMouseTiltOptions = {}): MouseTiltResult {
  const { maxTilt = 15, hoverScale = 1.02, disabled = false } = options;

  const ref = useRef<HTMLDivElement>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [tilt, setTilt] = useState({ rotateX: 0, rotateY: 0, glareX: 50, glareY: 50 });
  const rafRef = useRef<number | null>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled || !ref.current) return;

    // Cancel any pending animation frame
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = requestAnimationFrame(() => {
      if (!ref.current) return;

      const rect = ref.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      // Calculate normalized position (-1 to 1) from center
      const normalizedX = (e.clientX - centerX) / (rect.width / 2);
      const normalizedY = (e.clientY - centerY) / (rect.height / 2);

      // Clamp values
      const clampedX = Math.max(-1, Math.min(1, normalizedX));
      const clampedY = Math.max(-1, Math.min(1, normalizedY));

      // Calculate rotation (inverted for natural feel)
      const rotateY = clampedX * maxTilt;
      const rotateX = -clampedY * maxTilt;

      // Calculate glare position (0-100%)
      const glareX = ((clampedX + 1) / 2) * 100;
      const glareY = ((clampedY + 1) / 2) * 100;

      setTilt({ rotateX, rotateY, glareX, glareY });
    });
  }, [disabled, maxTilt]);

  const handleMouseEnter = useCallback(() => {
    if (!disabled) {
      setIsHovering(true);
    }
  }, [disabled]);

  const handleMouseLeave = useCallback(() => {
    setIsHovering(false);
    setTilt({ rotateX: 0, rotateY: 0, glareX: 50, glareY: 50 });
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
  }, []);

  return {
    rotateX: tilt.rotateX,
    rotateY: tilt.rotateY,
    glareX: tilt.glareX,
    glareY: tilt.glareY,
    isHovering,
    scale: isHovering && !disabled ? hoverScale : 1,
    ref,
    handlers: {
      onMouseMove: handleMouseMove,
      onMouseEnter: handleMouseEnter,
      onMouseLeave: handleMouseLeave,
    },
  };
}
