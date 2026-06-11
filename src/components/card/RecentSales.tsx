'use client';

import { useMemo, useState } from 'react';
import { PriceHistoryChart } from './PriceHistoryChart';
import { useGradeSelection } from './GradeSelectionContext';
import type { GradingCompany } from '@/lib/price-history';

interface RawSale {
  date: string;
  price: number;
  condition: string | null;
  variant: string | null;
  language: string | null;
  listing_type: string | null;
  custom_listing_id: string | null;
  quantity: number;
}

interface GradedSale {
  date: string;
  price: number;
  grading_company: GradingCompany;
  grade: string;
  title: string;
  listing_url: string | null;
  listing_format: string | null;
}

const PERIODS = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

function isNearMint(c: string | null) {
  const lower = (c || '').toLowerCase();
  return lower.includes('near mint') || lower === 'nm';
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function formatCurrency(value: number | null): string {
  if (value == null) return '—';
  return `$${value.toFixed(2)}`;
}

function formatSaleDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

type SaleSource = 'TCG' | 'eBay';

// ─────────────────────────────────────────────────────────────────────

interface RecentSalesProps {
  sales: RawSale[];
  gradedSales?: GradedSale[];
}

export function RecentSales({ sales, gradedSales = [] }: RecentSalesProps) {
  // Driven by the grade ladder: 'raw'/null → raw Near Mint sales;
  // '<company>-<grade>' → graded sales for that exact slab.
  const { key } = useGradeSelection();
  const graded = !!key && key !== 'raw';

  if (graded) {
    const idx = key!.indexOf('-');
    const company = key!.slice(0, idx) as GradingCompany;
    const grade = key!.slice(idx + 1);
    return <GradedSalesView sales={gradedSales} company={company} grade={grade} />;
  }
  return <RawSalesView sales={sales} />;
}

// ─────────────────────────────────────────────────────────────────────
// Raw sales
// ─────────────────────────────────────────────────────────────────────

function RawSalesView({ sales }: { sales: RawSale[] }) {
  const [period, setPeriod] = useState(30);

  // Variant + language filters — auto-build from sales data.
  // Default to "All" so we don't accidentally hide data when only one variant exists.
  const availableVariants = useMemo(() => {
    const set = new Set<string>();
    sales.forEach(s => s.variant && set.add(s.variant));
    return Array.from(set).sort();
  }, [sales]);
  const availableLanguages = useMemo(() => {
    const set = new Set<string>();
    sales.forEach(s => s.language && set.add(s.language));
    return Array.from(set).sort();
  }, [sales]);

  const [variant, setVariant] = useState<string>('All');
  const [language, setLanguage] = useState<string>('All');

  // When only one variant/language exists, default the filter to it (derived,
  // not stored — avoids setState-in-render). The chips for these only render
  // when there's more than one option, so this is purely the default.
  const effVariant = variant === 'All' && availableVariants.length === 1 ? availableVariants[0] : variant;
  const effLanguage = language === 'All' && availableLanguages.length === 1 ? availableLanguages[0] : language;

  const filtered = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - period);
    return sales.filter(s => {
      if (new Date(s.date) < cutoff) return false;
      // Raw view = the Near Mint market (the standard raw comp).
      if (!isNearMint(s.condition)) return false;
      if (effVariant !== 'All' && s.variant !== effVariant) return false;
      if (effLanguage !== 'All' && s.language !== effLanguage) return false;
      // Filter out seller-customized listings — those are someone listing a
      // different product under our SKU and inflate noise.
      if (s.custom_listing_id && s.custom_listing_id !== '0') return false;
      return true;
    });
  }, [sales, period, effVariant, effLanguage]);

  const newestFirst = useMemo(
    () => [...filtered].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [filtered],
  );
  const oldestFirst = useMemo(
    () => [...filtered].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    [filtered],
  );

  const lastSale = newestFirst[0]?.price ?? null;
  const lastFivePrices = newestFirst.slice(0, 5).map(s => s.price);
  const avgLastFive =
    lastFivePrices.length > 0 ? lastFivePrices.reduce((a, b) => a + b, 0) / lastFivePrices.length : null;
  const medianPrice = median(filtered.map(s => s.price));
  const trendPct =
    oldestFirst.length >= 2 && oldestFirst[0].price > 0
      ? ((oldestFirst[oldestFirst.length - 1].price - oldestFirst[0].price) / oldestFirst[0].price) * 100
      : null;

  if (sales.length === 0) {
    return <div className="p-6 text-center text-sm text-zinc-500">No recent sales data.</div>;
  }

  return (
    <div>
      <StatsRow
        lastSale={lastSale}
        avg={avgLastFive}
        avgCount={lastFivePrices.length}
        medianPrice={medianPrice}
        period={period}
        trendPct={trendPct}
      />

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4 flex-wrap">
        {availableVariants.length > 1 && (
          <ChipGroup
            options={['All', ...availableVariants]}
            value={effVariant}
            onChange={setVariant}
            ariaLabel="Variant"
          />
        )}
        {availableLanguages.length > 1 && (
          <ChipGroup
            options={['All', ...availableLanguages]}
            value={effLanguage}
            onChange={setLanguage}
            ariaLabel="Language"
          />
        )}
        <div className="hidden sm:block w-px h-5 bg-zinc-200" />
        <ChipGroup
          options={PERIODS.map(p => p.label)}
          value={`${period}d`}
          onChange={(label: string) => {
            const found = PERIODS.find(p => p.label === label);
            if (found) setPeriod(found.days);
          }}
          ariaLabel="Period"
        />
        <span className="text-xs text-zinc-400 sm:ml-auto">
          {filtered.length} sale{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Chart + list side by side on wide screens so more is visible without
          scrolling; stacks on narrow. */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-6 gap-y-4 items-start">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">Price trend</h3>
          {oldestFirst.length >= 2 ? (
            <PriceHistoryChart data={oldestFirst} />
          ) : (
            <div className="py-8 text-center text-xs text-zinc-400">Not enough sales in this window to chart.</div>
          )}
        </div>

        <SalesList
          rows={newestFirst.slice(0, 30).map(s => ({
            date: s.date,
            price: s.price,
            label: s.condition ?? undefined,
            source: 'TCG' as const,
            quantity: s.quantity,
          }))}
          emptyText={`No Near Mint sales in the last ${period} days.`}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Graded sales
// ─────────────────────────────────────────────────────────────────────

function GradedSalesView({ sales, company, grade }: { sales: GradedSale[]; company: GradingCompany; grade: string }) {
  const [period, setPeriod] = useState(90);

  const filtered = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - period);
    return sales.filter(
      s => s.grading_company === company && s.grade === grade && new Date(s.date) >= cutoff,
    );
  }, [sales, company, grade, period]);

  const newestFirst = useMemo(
    () => [...filtered].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [filtered],
  );
  const oldestFirst = useMemo(
    () => [...filtered].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    [filtered],
  );

  const lastSale = newestFirst[0]?.price ?? null;
  const lastFivePrices = newestFirst.slice(0, 5).map(s => s.price);
  const avgLastFive =
    lastFivePrices.length > 0 ? lastFivePrices.reduce((a, b) => a + b, 0) / lastFivePrices.length : null;
  const medianPrice = median(filtered.map(s => s.price));
  const trendPct =
    oldestFirst.length >= 2 && oldestFirst[0].price > 0
      ? ((oldestFirst[oldestFirst.length - 1].price - oldestFirst[0].price) / oldestFirst[0].price) * 100
      : null;

  return (
    <div>
      <StatsRow
        lastSale={lastSale}
        avg={avgLastFive}
        avgCount={lastFivePrices.length}
        medianPrice={medianPrice}
        period={period}
        trendPct={trendPct}
      />

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4 flex-wrap">
        <span className="text-sm font-semibold text-zinc-700">{company} {grade}</span>
        <ChipGroup
          options={PERIODS.map(p => p.label)}
          value={`${period}d`}
          onChange={(label: string) => {
            const found = PERIODS.find(p => p.label === label);
            if (found) setPeriod(found.days);
          }}
          ariaLabel="Period"
        />
        <span className="text-xs text-zinc-400 sm:ml-auto">
          {filtered.length} sale{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-6 gap-y-4 items-start">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">Price trend</h3>
          {oldestFirst.length >= 2 ? (
            <PriceHistoryChart data={oldestFirst.map(s => ({ date: s.date, price: s.price, condition: `${s.grading_company} ${s.grade}`, quantity: 1 }))} />
          ) : (
            <div className="py-8 text-center text-xs text-zinc-400">
              Not enough {company} {grade} sales in the last {period} days.
            </div>
          )}
        </div>

        <SalesList
          rows={newestFirst.slice(0, 30).map(s => ({
            date: s.date,
            price: s.price,
            label: `${s.grading_company} ${s.grade}`,
            source: 'eBay' as const,
            quantity: 1,
            href: s.listing_url ?? undefined,
            format: s.listing_format,
          }))}
          emptyText={`No ${company} ${grade} sales in the last ${period} days.`}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Shared bits
// ─────────────────────────────────────────────────────────────────────

function StatsRow({
  lastSale,
  avg,
  avgCount,
  medianPrice,
  period,
  trendPct,
}: {
  lastSale: number | null;
  avg: number | null;
  avgCount: number;
  medianPrice: number | null;
  period: number;
  trendPct: number | null;
}) {
  return (
    <div className="grid grid-cols-3 divide-x divide-zinc-200 border-y border-zinc-100 mb-4 [&>div:first-child]:pl-0">
      <Stat label="Last sale" value={formatCurrency(lastSale)} />
      <Stat
        label={avgCount < 5 ? `Avg last ${avgCount || 0}` : 'Avg last 5'}
        value={formatCurrency(avg)}
      />
      <Stat label={`Median ${period}d`} value={formatCurrency(medianPrice)} trend={trendPct} />
    </div>
  );
}

function Stat({
  label,
  value,
  trend,
}: {
  label: string;
  value: string;
  trend?: number | null;
}) {
  return (
    <div className="px-4 py-2 min-w-0">
      <div className="text-[10px] sm:text-xs uppercase tracking-wide text-zinc-400 truncate">{label}</div>
      <div className="text-base sm:text-lg font-bold text-zinc-900 tabular-nums">{value}</div>
      {trend != null && Math.abs(trend) >= 0.5 && (
        <div className={`text-[10px] sm:text-xs font-medium ${trend > 0 ? 'text-green-600' : 'text-red-500'}`}>
          {trend > 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

function ChipGroup<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="inline-flex gap-1 p-0.5 bg-zinc-100 rounded-lg" role="group" aria-label={ariaLabel}>
      {options.map(opt => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
            value === opt
              ? 'bg-white text-zinc-900 shadow-sm'
              : 'text-zinc-500 hover:text-zinc-900'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}


interface SaleRow {
  date: string;
  price: number;
  label?: string;     // condition or grade — primary text on the row
  source: SaleSource;
  quantity: number;
  href?: string;
  format?: string | null;  // eBay listing format — flag Best Offer
}

function SalesList({ rows, emptyText }: { rows: SaleRow[]; emptyText: string }) {
  return (
    <div className="min-w-0">
      <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">Sales</h3>
      {rows.length === 0 ? (
        <div className="py-8 text-center text-xs text-zinc-400">{emptyText}</div>
      ) : (
        // Clean divided rows (Robinhood-style), no heavy box — matches the
        // /collection transactions list.
        <ul className="divide-y divide-zinc-100 max-h-96 overflow-y-auto overflow-x-hidden">
          {rows.map((r, i) => (
            <SaleListItem key={`${r.date}-${i}`} row={r} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SaleListItem({ row }: { row: SaleRow }) {
  const isEbay = row.source === 'eBay';
  const linkable = isEbay && !!row.href;
  const inner = (
    <div className="flex items-center gap-3 py-3">
      {/* Source dot: blue = eBay graded sale, zinc = TCGplayer raw sale. */}
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isEbay ? 'bg-blue-500' : 'bg-zinc-300'}`} aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-zinc-900 truncate">
            {row.label ?? (isEbay ? 'Graded sale' : 'Sale')}
          </span>
          {linkable && <span className="flex-shrink-0 text-[11px] font-medium text-blue-600">eBay ↗</span>}
          {row.format === 'best_offer' && (
            <span
              className="flex-shrink-0 text-[10px] font-medium px-1 py-0.5 rounded bg-orange-50 text-orange-600"
              title="Best Offer — eBay shows the asking price, not the (hidden) accepted offer"
            >
              Best Offer
            </span>
          )}
        </div>
        <div className="text-xs text-zinc-400 mt-0.5">
          {formatSaleDate(row.date)} · {row.source}
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        {/* Accepted-offer "sold" price is the struck-out ask, not the real
            (hidden) price — render it crossed out, like eBay does. */}
        <div
          className={`text-sm font-bold tabular-nums ${row.format === 'best_offer' ? 'text-zinc-400 line-through' : 'text-zinc-900'}`}
        >
          ${row.price.toFixed(2)}
        </div>
        {row.quantity > 1 && <div className="text-[10px] text-zinc-400">×{row.quantity}</div>}
      </div>
    </div>
  );

  return (
    <li>
      {linkable ? (
        <a
          href={row.href}
          target="_blank"
          rel="noopener noreferrer"
          title="View this sale on eBay"
          className="block rounded-lg hover:bg-zinc-50 transition-colors"
        >
          {inner}
        </a>
      ) : (
        inner
      )}
    </li>
  );
}
