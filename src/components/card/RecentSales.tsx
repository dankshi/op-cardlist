'use client';

import { useMemo, useState } from 'react';
import { PriceHistoryChart } from './PriceHistoryChart';
import type { GradingCompany } from '@/lib/price-history';

interface RawSale {
  date: string;
  price: number;
  condition: string | null;
  quantity: number;
}

interface GradedSale {
  date: string;
  price: number;
  grading_company: GradingCompany;
  grade: string;
  title: string;
  listing_url: string | null;
}

type ConditionFilter = 'NM' | 'LP' | 'All';
type Tab = 'raw' | 'graded';

const PERIODS = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

const CONDITIONS: ConditionFilter[] = ['NM', 'LP', 'All'];
const COMPANIES: GradingCompany[] = ['PSA', 'CGC', 'BGS', 'TAG'];

function matchesCondition(c: string | null, filter: ConditionFilter) {
  if (filter === 'All') return true;
  const lower = (c || '').toLowerCase();
  if (filter === 'NM') return lower.includes('near mint') || lower === 'nm';
  if (filter === 'LP') return lower.includes('lightly played') || lower === 'lp';
  return true;
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
  const hasGraded = gradedSales.length > 0;
  const [tab, setTab] = useState<Tab>('raw');

  return (
    <div>
      {hasGraded && (
        <div className="flex gap-1 mb-4 border-b border-zinc-200">
          <TabButton active={tab === 'raw'} onClick={() => setTab('raw')}>
            Raw
          </TabButton>
          <TabButton active={tab === 'graded'} onClick={() => setTab('graded')}>
            Graded
          </TabButton>
        </div>
      )}

      {tab === 'raw' || !hasGraded ? (
        <RawSalesView sales={sales} />
      ) : (
        <GradedSalesView sales={gradedSales} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Raw sales
// ─────────────────────────────────────────────────────────────────────

function RawSalesView({ sales }: { sales: RawSale[] }) {
  const [period, setPeriod] = useState(30);
  const [condition, setCondition] = useState<ConditionFilter>('NM');

  const filtered = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - period);
    return sales.filter(s => new Date(s.date) >= cutoff && matchesCondition(s.condition, condition));
  }, [sales, period, condition]);

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

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4">
        <ChipGroup options={CONDITIONS} value={condition} onChange={setCondition} ariaLabel="Condition" />
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

      {oldestFirst.length >= 2 ? (
        <PriceHistoryChart data={oldestFirst} />
      ) : (
        <div className="py-8 text-center text-xs text-zinc-400">Not enough sales in this window to chart.</div>
      )}

      <SalesList
        rows={newestFirst.slice(0, 30).map(s => ({
          date: s.date,
          price: s.price,
          label: s.condition ?? undefined,
          source: 'TCG' as const,
          quantity: s.quantity,
        }))}
        emptyText={`No ${condition === 'All' ? '' : condition + ' '}sales in the last ${period} days.`}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Graded sales
// ─────────────────────────────────────────────────────────────────────

function GradedSalesView({ sales }: { sales: GradedSale[] }) {
  const [period, setPeriod] = useState(90);

  // Companies present in the data, plus the canonical list as fallback
  const availableCompanies = useMemo(() => {
    const set = new Set(sales.map(s => s.grading_company));
    return COMPANIES.filter(c => set.has(c)).length > 0
      ? COMPANIES.filter(c => set.has(c))
      : COMPANIES;
  }, [sales]);

  const [company, setCompany] = useState<GradingCompany>(availableCompanies[0] ?? 'PSA');

  // Grades observed for the selected company, sorted high→low
  const availableGrades = useMemo(() => {
    const grades = Array.from(new Set(sales.filter(s => s.grading_company === company).map(s => s.grade)));
    grades.sort((a, b) => parseFloat(b) - parseFloat(a));
    return grades;
  }, [sales, company]);

  const [grade, setGrade] = useState<string>(availableGrades[0] ?? '10');

  // Keep grade in sync when company changes
  useMemo(() => {
    if (availableGrades.length > 0 && !availableGrades.includes(grade)) {
      setGrade(availableGrades[0]);
    }
  }, [availableGrades, grade]);

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
        <ChipGroup options={availableCompanies} value={company} onChange={setCompany} ariaLabel="Grading company" />
        {availableGrades.length > 0 && (
          <ChipGroup
            options={availableGrades}
            value={grade}
            onChange={setGrade}
            ariaLabel="Grade"
          />
        )}
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

      {oldestFirst.length >= 2 ? (
        <PriceHistoryChart data={oldestFirst.map(s => ({ date: s.date, price: s.price, condition: `${s.grading_company} ${s.grade}`, quantity: 1 }))} />
      ) : (
        <div className="py-8 text-center text-xs text-zinc-400">
          Not enough {company} {grade} sales in the last {period} days.
        </div>
      )}

      <SalesList
        rows={newestFirst.slice(0, 30).map(s => ({
          date: s.date,
          price: s.price,
          label: `${s.grading_company} ${s.grade}`,
          source: 'eBay' as const,
          quantity: 1,
          href: s.listing_url ?? undefined,
        }))}
        emptyText={`No ${company} ${grade} sales in the last ${period} days.`}
      />
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
    <div className="grid grid-cols-3 gap-2 mb-4">
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
    <div className="bg-zinc-50 rounded-lg px-3 py-2.5 min-w-0">
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

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium transition-colors cursor-pointer ${
        active
          ? 'text-zinc-900 border-b-2 border-zinc-900 -mb-px'
          : 'text-zinc-500 hover:text-zinc-700'
      }`}
    >
      {children}
    </button>
  );
}

interface SaleRow {
  date: string;
  price: number;
  label?: string;     // condition or grade — primary text on the row
  source: SaleSource;
  quantity: number;
  href?: string;
}

function SalesList({ rows, emptyText }: { rows: SaleRow[]; emptyText: string }) {
  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
          Recent Transactions
        </h3>
        {rows.length > 0 && (
          <span className="text-xs text-zinc-400">{rows.length} shown</span>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="py-8 text-center text-xs text-zinc-400 border border-zinc-200 rounded-lg">
          {emptyText}
        </div>
      ) : (
        <div className="border border-zinc-200 rounded-lg overflow-hidden">
          <ul className="divide-y divide-zinc-100 max-h-96 overflow-y-auto">
            {rows.map((r, i) => (
              <SaleListItem key={`${r.date}-${i}`} row={r} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SaleListItem({ row }: { row: SaleRow }) {
  const inner = (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 transition-colors">
      <SourceBadge source={row.source} />
      <div className="flex-1 min-w-0">
        {row.label && (
          <div className="text-sm font-medium text-zinc-900 truncate">{row.label}</div>
        )}
        <div className="text-xs text-zinc-500 mt-0.5">{formatSaleDate(row.date)}</div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-sm font-bold text-zinc-900 tabular-nums">
          ${row.price.toFixed(2)}
        </div>
        {row.quantity > 1 && (
          <div className="text-[10px] text-zinc-400">×{row.quantity}</div>
        )}
      </div>
    </div>
  );

  return (
    <li>
      {row.href ? (
        <a href={row.href} target="_blank" rel="noopener noreferrer" className="block">
          {inner}
        </a>
      ) : (
        inner
      )}
    </li>
  );
}

function SourceBadge({ source }: { source: SaleSource }) {
  return (
    <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 bg-zinc-50 border border-zinc-200 rounded px-1.5 py-0.5">
      {source}
    </span>
  );
}
