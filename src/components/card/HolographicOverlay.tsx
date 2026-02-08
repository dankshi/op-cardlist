"use client";

interface HolographicOverlayProps {
  glareX: number;
  glareY: number;
  intensity?: number;
  animated?: boolean;
}

export function HolographicOverlay({
  glareX,
  glareY,
  intensity = 0.6,
  animated = false,
}: HolographicOverlayProps) {
  // Calculate the angle for the conic gradient based on glare position
  const angle = Math.atan2(glareY - 50, glareX - 50) * (180 / Math.PI) + 90;

  return (
    <>
      {/* Rainbow holographic layer */}
      <div
        className={`absolute inset-0 pointer-events-none rounded-lg overflow-hidden ${
          animated ? "holo-animated" : ""
        }`}
        style={{
          background: `
            conic-gradient(
              from ${angle}deg at ${glareX}% ${glareY}%,
              hsl(0, 90%, 65%) 0deg,
              hsl(45, 90%, 60%) 60deg,
              hsl(90, 85%, 55%) 120deg,
              hsl(180, 90%, 60%) 180deg,
              hsl(240, 85%, 65%) 240deg,
              hsl(300, 85%, 60%) 300deg,
              hsl(360, 90%, 65%) 360deg
            )
          `,
          maskImage: `radial-gradient(
            ellipse 100% 100% at ${glareX}% ${glareY}%,
            black 0%,
            rgba(0,0,0,0.6) 30%,
            transparent 70%
          )`,
          WebkitMaskImage: `radial-gradient(
            ellipse 100% 100% at ${glareX}% ${glareY}%,
            black 0%,
            rgba(0,0,0,0.6) 30%,
            transparent 70%
          )`,
          mixBlendMode: "overlay",
          opacity: intensity,
          filter: "blur(1px) saturate(1.3)",
        }}
      />

      {/* Glare/shine effect */}
      <div
        className="absolute inset-0 pointer-events-none rounded-lg overflow-hidden"
        style={{
          background: `radial-gradient(
            ellipse 50% 50% at ${glareX}% ${glareY}%,
            rgba(255, 255, 255, 0.4) 0%,
            rgba(255, 255, 255, 0.1) 40%,
            transparent 70%
          )`,
          mixBlendMode: "overlay",
          opacity: intensity * 0.8,
        }}
      />

      {/* Subtle sparkle texture effect */}
      <div
        className="absolute inset-0 pointer-events-none rounded-lg overflow-hidden"
        style={{
          backgroundImage: `
            radial-gradient(circle at ${glareX + 10}% ${glareY - 10}%, rgba(255,255,255,0.3) 0%, transparent 2%),
            radial-gradient(circle at ${glareX - 15}% ${glareY + 5}%, rgba(255,255,255,0.25) 0%, transparent 1.5%),
            radial-gradient(circle at ${glareX + 5}% ${glareY + 15}%, rgba(255,255,255,0.2) 0%, transparent 1%)
          `,
          mixBlendMode: "overlay",
          opacity: intensity,
        }}
      />
    </>
  );
}
