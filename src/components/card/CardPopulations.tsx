'use client';

import { useState } from 'react';

type Company = 'PSA' | 'BGS' | 'CGC';

interface PopulationBucket {
  grade: string;
  count: number | null;
}

interface CardPopulationsProps {
  /** Optional populations data keyed by company → array of {grade, count}. */
  populations?: Partial<Record<Company, PopulationBucket[]>>;
  /** Called when the user picks a (company, grade) — for future cross-filtering with RecentSales. */
  onSelect?: (company: Company, grade: string) => void;
}

// Default grade buckets shown for each company until real pop data exists.
// Ordered from highest grade left → lowest right, mirroring ALT.
const DEFAULT_BUCKETS: Record<Company, PopulationBucket[]> = {
  PSA: [
    { grade: '10', count: null },
    { grade: '9', count: null },
    { grade: '8', count: null },
  ],
  BGS: [
    { grade: 'BL', count: null }, // Black Label 10
    { grade: '10', count: null },
    { grade: '9.5', count: null },
    { grade: '9', count: null },
    { grade: '8.5', count: null },
    { grade: '8', count: null },
  ],
  CGC: [
    { grade: 'BL', count: null }, // Perfect 10 / Black Label
    { grade: '10', count: null },
    { grade: '9', count: null },
    { grade: '8.5', count: null },
  ],
};

const COMPANIES: Company[] = ['PSA', 'BGS', 'CGC'];

function formatCount(n: number | null): string {
  if (n == null) return '—';
  return n.toLocaleString();
}

export function CardPopulations({ populations, onSelect }: CardPopulationsProps) {
  const data: Record<Company, PopulationBucket[]> = {
    PSA: populations?.PSA ?? DEFAULT_BUCKETS.PSA,
    BGS: populations?.BGS ?? DEFAULT_BUCKETS.BGS,
    CGC: populations?.CGC ?? DEFAULT_BUCKETS.CGC,
  };

  const hasAnyData = COMPANIES.some(c => (data[c] ?? []).some(b => b.count != null));

  const [selected, setSelected] = useState<{ company: Company; grade: string } | null>(null);

  function handleClick(company: Company, grade: string) {
    setSelected({ company, grade });
    onSelect?.(company, grade);
  }

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        {COMPANIES.map(company => (
          <div key={company}>
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
              {company} Population
            </h3>
            <div className="flex gap-1 overflow-x-auto">
              {data[company].map(bucket => {
                const isSelected =
                  selected?.company === company && selected?.grade === bucket.grade;
                return (
                  <button
                    key={bucket.grade}
                    type="button"
                    onClick={() => handleClick(company, bucket.grade)}
                    className={`flex-1 min-w-[52px] py-2 px-2 rounded-md border text-center transition-colors cursor-pointer ${
                      isSelected
                        ? 'border-orange-500 bg-orange-50'
                        : 'border-zinc-200 bg-white hover:border-zinc-300'
                    }`}
                  >
                    <div
                      className={`text-[11px] font-medium ${
                        isSelected ? 'text-orange-600' : 'text-zinc-500'
                      }`}
                    >
                      {bucket.grade}
                    </div>
                    <div className="text-sm font-bold text-zinc-900 tabular-nums">
                      {formatCount(bucket.count)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {!hasAnyData && (
        <p className="text-[11px] text-zinc-400">Population data not yet available.</p>
      )}
    </div>
  );
}
