'use client';

import { useState, useRef, useCallback, useMemo } from 'react';

interface Sale {
  date: string;
  price: number;
  condition: string | null;
  quantity: number;
}

interface PriceHistoryChartProps {
  data: Sale[];
}

const PERIODS = [
  { label: '7d', days: 7 },
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
];

const SVG_WIDTH = 600;
const SVG_HEIGHT = 160;
const PADDING = { top: 12, right: 12, bottom: 24, left: 12 };
const CHART_WIDTH = SVG_WIDTH - PADDING.left - PADDING.right;
const CHART_HEIGHT = SVG_HEIGHT - PADDING.top - PADDING.bottom;

export function PriceHistoryChart({ data }: PriceHistoryChartProps) {
  const [period, setPeriod] = useState(30);
  const [hover, setHover] = useState<{ x: number; index: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Filter to period
  const sliced = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - period);
    return data.filter(d => new Date(d.date) >= cutoff);
  }, [data, period]);

  if (sliced.length < 2) return null;

  const prices = sliced.map(d => d.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice || 1;
  const yPad = priceRange * 0.15;
  const yMin = minPrice - yPad;
  const yMax = maxPrice + yPad;

  // Map date range to x-axis
  const minTime = new Date(sliced[0].date).getTime();
  const maxTime = new Date(sliced[sliced.length - 1].date).getTime();
  const timeRange = maxTime - minTime || 1;

  const toX = (date: string) => PADDING.left + ((new Date(date).getTime() - minTime) / timeRange) * CHART_WIDTH;
  const toY = (price: number) => PADDING.top + (1 - (price - yMin) / (yMax - yMin)) * CHART_HEIGHT;

  // Build line path
  const linePath = sliced
    .map((d, i) => `${i === 0 ? 'M' : 'L'}${toX(d.date).toFixed(1)},${toY(d.price).toFixed(1)}`)
    .join(' ');

  // X-axis labels
  const fmt = (d: string) => {
    const date = new Date(d);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || sliced.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * SVG_WIDTH;
    const relX = mouseX - PADDING.left;
    // Find nearest point by x distance
    let nearest = 0;
    let bestDist = Infinity;
    for (let i = 0; i < sliced.length; i++) {
      const dist = Math.abs(toX(sliced[i].date) - mouseX);
      if (dist < bestDist) {
        bestDist = dist;
        nearest = i;
      }
    }
    setHover({ x: toX(sliced[nearest].date), index: nearest });
  }, [sliced]);

  const handleMouseLeave = useCallback(() => setHover(null), []);

  const hoverPoint = hover ? sliced[hover.index] : null;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1">
          {PERIODS.map(p => (
            <button
              key={p.days}
              onClick={() => setPeriod(p.days)}
              className={`px-2.5 py-0.5 rounded text-xs font-medium transition-colors cursor-pointer ${
                period === p.days
                  ? 'bg-zinc-900 text-white'
                  : 'text-zinc-400 hover:text-zinc-600'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {hoverPoint ? (
          <div className="text-xs text-zinc-500">
            <span className="font-semibold text-zinc-900">${hoverPoint.price.toFixed(2)}</span>
            {hoverPoint.condition && (
              <span className="ml-1.5 text-zinc-400">{hoverPoint.condition}</span>
            )}
            <span className="ml-1.5">
              {new Date(hoverPoint.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          </div>
        ) : (
          <div className="text-xs text-zinc-400">
            {sliced.length} sale{sliced.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Chart */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        className="w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Line */}
        <path
          d={linePath}
          fill="none"
          stroke="#a1a1aa"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* X-axis labels */}
        <text
          x={PADDING.left}
          y={PADDING.top + CHART_HEIGHT + 16}
          textAnchor="start"
          className="text-[10px]"
          fill="#d4d4d8"
        >
          {fmt(sliced[0].date)}
        </text>
        <text
          x={PADDING.left + CHART_WIDTH}
          y={PADDING.top + CHART_HEIGHT + 16}
          textAnchor="end"
          className="text-[10px]"
          fill="#d4d4d8"
        >
          {fmt(sliced[sliced.length - 1].date)}
        </text>

        {/* Hover indicator */}
        {hover && hoverPoint && (
          <>
            <line
              x1={hover.x}
              y1={PADDING.top}
              x2={hover.x}
              y2={PADDING.top + CHART_HEIGHT}
              stroke="#d4d4d8"
              strokeWidth="1"
            />
            <circle
              cx={hover.x}
              cy={toY(hoverPoint.price)}
              r="4"
              fill="#18181b"
              stroke="white"
              strokeWidth="2"
            />
          </>
        )}
      </svg>
    </div>
  );
}
