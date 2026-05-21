import type { ReactNode } from "react";

interface PriceRowProps {
  price: number;
  /**
   * Label rendered above the price. Defaults to "MARKET". Pass a node for
   * richer content (e.g. a ConditionBadge for listings).
   */
  label?: ReactNode;
  /** Optional week-over-week % change. Rendered inline next to the price. */
  changePercent?: number | null;
  /** Optional metadata rendered below the price row (e.g. "2h ago"). */
  footer?: ReactNode;
  /** Optional right-aligned element (e.g. a "VIEW" pill on the grid view). */
  trailing?: ReactNode;
}

function formatUSD(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const DEFAULT_LABEL = (
  <span className="text-[10px] uppercase tracking-[0.14em] text-zinc-500 font-semibold">
    Market
  </span>
);

export function PriceRow({
  price,
  label,
  changePercent,
  footer,
  trailing,
}: PriceRowProps) {
  const hasDelta = changePercent != null;
  const isUp = hasDelta && changePercent! > 0;
  const isDown = hasDelta && changePercent! < 0;
  const deltaText = hasDelta
    ? `${isUp ? '+' : ''}${changePercent!.toFixed(1)}%`
    : null;
  const deltaColor = isUp ? 'text-emerald-600' : isDown ? 'text-rose-600' : 'text-zinc-500';

  // Wrap string labels in the default styling; pass nodes through as-is so
  // callers can drop in their own badges.
  const labelNode = typeof label === 'string'
    ? <span className="text-[10px] uppercase tracking-[0.14em] text-zinc-500 font-semibold">{label}</span>
    : (label ?? DEFAULT_LABEL);

  return (
    <div className="mt-2 flex items-end justify-between gap-2">
      <div className="min-w-0">
        {labelNode}
        <div className="flex items-baseline gap-2 mt-0.5">
          <span className="text-lg font-semibold tracking-tight tabular-nums text-zinc-900">
            ${formatUSD(price)}
          </span>
          {deltaText && (
            <span className={`text-xs font-medium tabular-nums ${deltaColor}`}>
              {deltaText}
            </span>
          )}
        </div>
        {footer && (
          <div className="text-[11px] text-zinc-400 mt-1">{footer}</div>
        )}
      </div>
      {trailing && <div className="shrink-0">{trailing}</div>}
    </div>
  );
}

export function ViewPill() {
  return (
    <span
      aria-hidden="true"
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold uppercase tracking-wider text-orange-600 ring-1 ring-orange-500/40 bg-white group-hover:bg-orange-500 group-hover:text-white group-hover:ring-orange-500 transition-colors"
    >
      View
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </span>
  );
}
