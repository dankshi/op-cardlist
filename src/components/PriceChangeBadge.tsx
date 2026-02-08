'use client';

interface PriceChangeBadgeProps {
  changePercent: number;
  size?: 'sm' | 'md' | 'lg';
  showIcon?: boolean;
}

export function PriceChangeBadge({
  changePercent,
  size = 'sm',
  showIcon = true,
}: PriceChangeBadgeProps) {
  const isPositive = changePercent > 0;
  const isNegative = changePercent < 0;

  // Size classes
  const sizeClasses = {
    sm: 'text-xs px-1.5 py-0.5',
    md: 'text-sm px-2 py-1',
    lg: 'text-base px-3 py-1.5',
  };

  // Color classes based on direction
  const colorClasses = isPositive
    ? 'bg-green-500/20 text-green-400 border-green-500/30'
    : isNegative
    ? 'bg-red-500/20 text-red-400 border-red-500/30'
    : 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30';

  // Format percentage
  const formattedPercent = isPositive
    ? `+${changePercent.toFixed(1)}%`
    : `${changePercent.toFixed(1)}%`;

  // Icon
  const icon = isPositive ? (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
    </svg>
  ) : isNegative ? (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
    </svg>
  ) : null;

  return (
    <span
      className={`
        inline-flex items-center gap-1 font-medium rounded border
        ${sizeClasses[size]} ${colorClasses}
      `}
    >
      {showIcon && icon}
      {formattedPercent}
    </span>
  );
}

/**
 * Server component wrapper that calculates price change
 */
interface PriceChangeDisplayProps {
  currentPrice: number | null;
  previousPrice: number | null;
  size?: 'sm' | 'md' | 'lg';
}

export function PriceChangeDisplay({
  currentPrice,
  previousPrice,
  size = 'sm',
}: PriceChangeDisplayProps) {
  if (currentPrice == null || previousPrice == null || previousPrice === 0) {
    return null;
  }

  const changePercent = ((currentPrice - previousPrice) / previousPrice) * 100;

  // Only show if change is significant (>= 5%)
  if (Math.abs(changePercent) < 5) {
    return null;
  }

  return <PriceChangeBadge changePercent={changePercent} size={size} />;
}
