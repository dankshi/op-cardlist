"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";

interface RecentEntry {
  id: string;
  name: string;
  imageUrl: string;
  viewedAt: number;
}

const STORAGE_KEY = "nomi:recently-viewed";

export function RecentlyViewed() {
  const [entries, setEntries] = useState<RecentEntry[] | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        setEntries([]);
        return;
      }
      const parsed = JSON.parse(raw) as RecentEntry[];
      if (!Array.isArray(parsed)) {
        setEntries([]);
        return;
      }
      const cleaned = parsed
        .filter((e) => e && typeof e.id === "string" && typeof e.imageUrl === "string")
        .sort((a, b) => (b.viewedAt ?? 0) - (a.viewedAt ?? 0))
        .slice(0, 12);
      setEntries(cleaned);
    } catch {
      setEntries([]);
    }
  }, []);

  if (entries === null || entries.length === 0) return null;

  return (
    <section className="mb-12 sm:mb-16">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2 text-zinc-900">
            <svg className="w-5 h-5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Continue browsing
          </h2>
          <p className="text-sm text-zinc-500 mt-1">Cards you viewed recently</p>
        </div>
      </div>
      <div className="flex gap-3 sm:gap-4 overflow-x-auto scrollbar-hide pb-2">
        {entries.map((entry) => (
          <Link
            key={entry.id}
            href={`/card/${entry.id.toLowerCase()}`}
            className="w-[120px] sm:w-[140px] flex-shrink-0 group"
          >
            <div className="aspect-[5/7] rounded-md overflow-hidden ring-1 ring-zinc-200 bg-white">
              <Image
                src={entry.imageUrl}
                alt={entry.name}
                width={140}
                height={196}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                unoptimized
              />
            </div>
            <p className="mt-2 text-xs text-zinc-700 truncate group-hover:text-zinc-900 transition-colors">
              {entry.name}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function recordRecentlyViewed(entry: { id: string; name: string; imageUrl: string }) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const existing = raw ? (JSON.parse(raw) as RecentEntry[]) : [];
    const filtered = Array.isArray(existing)
      ? existing.filter((e) => e?.id !== entry.id)
      : [];
    const next: RecentEntry[] = [
      { ...entry, viewedAt: Date.now() },
      ...filtered,
    ].slice(0, 24);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore quota / parse errors
  }
}

export function RecordView({ id, name, imageUrl }: { id: string; name: string; imageUrl: string }) {
  useEffect(() => {
    recordRecentlyViewed({ id, name, imageUrl });
  }, [id, name, imageUrl]);
  return null;
}
