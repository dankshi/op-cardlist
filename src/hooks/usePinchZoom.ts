"use client";

import { useState, useCallback, useRef, RefObject, useEffect } from "react";

export interface PinchZoomResult {
  scale: number;
  translateX: number;
  translateY: number;
  isZoomed: boolean;
  reset: () => void;
  ref: RefObject<HTMLDivElement | null>;
}

interface UsePinchZoomOptions {
  maxScale?: number;
  minScale?: number;
  doubleTapScale?: number;
  disabled?: boolean;
}

export function usePinchZoom(options: UsePinchZoomOptions = {}): PinchZoomResult {
  const { maxScale = 3, minScale = 1, doubleTapScale = 2, disabled = false } = options;

  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });

  // Touch tracking refs
  const initialDistance = useRef<number | null>(null);
  const initialScale = useRef(1);
  const lastTap = useRef(0);
  const lastPanPoint = useRef<{ x: number; y: number } | null>(null);

  const getDistance = (touch1: Touch, touch2: Touch): number => {
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const reset = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (disabled) return;

    // Pinch start (two fingers)
    if (e.touches.length === 2) {
      e.preventDefault();
      initialDistance.current = getDistance(e.touches[0], e.touches[1]);
      initialScale.current = scale;
      lastPanPoint.current = null;
    }
    // Pan start (one finger when zoomed) or double-tap detection
    else if (e.touches.length === 1) {
      const now = Date.now();
      const timeSinceLastTap = now - lastTap.current;

      // Double-tap detection
      if (timeSinceLastTap < 300 && timeSinceLastTap > 0) {
        e.preventDefault();
        if (scale > 1) {
          reset();
        } else {
          setScale(doubleTapScale);
        }
        lastTap.current = 0;
      } else {
        lastTap.current = now;
        if (scale > 1) {
          lastPanPoint.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
      }
    }
  }, [disabled, scale, doubleTapScale, reset]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (disabled) return;

    // Pinch zoom
    if (e.touches.length === 2 && initialDistance.current !== null) {
      e.preventDefault();
      const currentDistance = getDistance(e.touches[0], e.touches[1]);
      const scaleChange = currentDistance / initialDistance.current;
      const newScale = Math.max(minScale, Math.min(maxScale, initialScale.current * scaleChange));
      setScale(newScale);
    }
    // Pan when zoomed
    else if (e.touches.length === 1 && scale > 1 && lastPanPoint.current) {
      e.preventDefault();
      const currentPoint = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      const dx = currentPoint.x - lastPanPoint.current.x;
      const dy = currentPoint.y - lastPanPoint.current.y;

      // Constrain pan to zoomed bounds
      const maxTranslate = ((scale - 1) / scale) * 50;
      setTranslate(prev => ({
        x: Math.max(-maxTranslate, Math.min(maxTranslate, prev.x + dx * 0.5)),
        y: Math.max(-maxTranslate, Math.min(maxTranslate, prev.y + dy * 0.5)),
      }));

      lastPanPoint.current = currentPoint;
    }
  }, [disabled, scale, minScale, maxScale]);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (e.touches.length < 2) {
      initialDistance.current = null;
    }
    if (e.touches.length === 0) {
      lastPanPoint.current = null;
      // Snap back if scale is close to 1
      if (scale < 1.1) {
        reset();
      }
    }
  }, [scale, reset]);

  // Attach touch event listeners
  useEffect(() => {
    const element = ref.current;
    if (!element || disabled) return;

    element.addEventListener("touchstart", handleTouchStart, { passive: false });
    element.addEventListener("touchmove", handleTouchMove, { passive: false });
    element.addEventListener("touchend", handleTouchEnd);

    return () => {
      element.removeEventListener("touchstart", handleTouchStart);
      element.removeEventListener("touchmove", handleTouchMove);
      element.removeEventListener("touchend", handleTouchEnd);
    };
  }, [disabled, handleTouchStart, handleTouchMove, handleTouchEnd]);

  return {
    scale,
    translateX: translate.x,
    translateY: translate.y,
    isZoomed: scale > 1,
    reset,
    ref,
  };
}
