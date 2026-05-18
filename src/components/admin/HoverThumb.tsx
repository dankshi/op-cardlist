'use client'

/* eslint-disable @next/next/no-img-element */
import { useState } from 'react'

interface Props {
  /** Image URL. Used for both the thumbnail and the enlarged preview. */
  src: string
  /** Alt text for the thumbnail. The preview is decorative (alt=""). */
  alt: string
  /** Tailwind classes for the thumbnail. Default suits grid tiles. */
  className?: string
  /** href for the wrapping link. Defaults to opening the full image in a
   *  new tab — same as the previous static <a><img/></a> pattern. Pass a
   *  different href (e.g. /card/<id>) to navigate instead. */
  href?: string
}

/** Thumbnail that fixed-positions a larger version of the same image near
 *  the cursor on hover. Designed for admin pages where you want to scan
 *  rows quickly and confirm details without leaving the page. Click still
 *  opens the full image in a new tab. */
export function HoverThumb({ src, alt, className, href }: Props) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  // Keep the preview on-screen: 320px wide, ~448px tall (5:7 card ratio).
  // Clamp against the viewport so a hover near the right or bottom edge
  // doesn't push the preview off-screen. SSR-safe via typeof check.
  const previewW = 320
  const previewH = 448
  const offset = 20
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1920
  const vh = typeof window !== 'undefined' ? window.innerHeight : 1080
  const previewLeft = pos ? Math.min(pos.x + offset, vw - previewW - 8) : 0
  const previewTop = pos
    ? Math.max(8, Math.min(pos.y - previewH / 2, vh - previewH - 8))
    : 0

  const linkHref = href ?? src

  return (
    <a
      href={linkHref}
      target={href ? undefined : '_blank'}
      rel="noreferrer"
      className="block hover:opacity-80 transition-opacity"
    >
      <img
        src={src}
        alt={alt}
        className={className ?? 'w-full rounded border border-zinc-200'}
        loading="lazy"
        onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setPos(null)}
      />
      {pos && (
        <img
          src={src}
          alt=""
          className="fixed z-50 pointer-events-none rounded-lg shadow-2xl border border-zinc-200"
          style={{ left: previewLeft, top: previewTop, width: previewW }}
        />
      )}
    </a>
  )
}
