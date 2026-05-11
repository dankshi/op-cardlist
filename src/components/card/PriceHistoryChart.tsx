'use client';

import { useState, useRef, useCallback } from 'react';

interface Sale {
  date: string;
  price: number;
  condition: string | null;
  quantity: number;
}

interface PriceHistoryChartProps {
  data: Sale[];
}

const SVG_WIDTH = 600;
const SVG_HEIGHT = 160;
const PADDING = { top: 12, right: 12, bottom: 24, left: 12 };
const CHART_WIDTH = SVG_WIDTH - PADDING.left - PADDING.right;
const CHART_HEIGHT = SVG_HEIGHT - PADDING.top - PADDING.bottom;

export function PriceHistoryChart({ data }: PriceHistoryChartProps) {
  const [hover, setHover] = useState<{ x: number; index: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (data.length < 2) return null;

  // Data is expected to be already sorted ascending by date.
  const prices = data.map(d => d.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice || 1;
  const yPad = priceRange * 0.15;
  const yMin = minPrice - yPad;
  const yMax = maxPrice + yPad;

  const minTime = new Date(data[0].date).getTime();
  const maxTime = new Date(data[data.length - 1].date).getTime();
  const timeRange = maxTime - minTime || 1;

  const toX = (date: string) =>
    PADDING.left + ((new Date(date).getTime() - minTime) / timeRange) * CHART_WIDTH;
  const toY = (price: number) =>
    PADDING.top + (1 - (price - yMin) / (yMax - yMin)) * CHART_HEIGHT;

  const linePath = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'}${toX(d.date).toFixed(1)},${toY(d.price).toFixed(1)}`)
    .join(' ');

  const fmt = (d: string) => {
    const date = new Date(d);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current || data.length === 0) return;
      const rect = svgRef.current.getBoundingClientRect();
      const mouseX = ((e.clientX - rect.left) / rect.width) * SVG_WIDTH;
      let nearest = 0;
      let bestDist = Infinity;
      for (let i = 0; i < data.length; i++) {
        const dist = Math.abs(toX(data[i].date) - mouseX);
        if (dist < bestDist) {
          bestDist = dist;
          nearest = i;
        }
      }
      setHover({ x: toX(data[nearest].date), index: nearest });
    },
    // toX captures data; safe because we re-render on prop change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data],
  );

  const handleMouseLeave = useCallback(() => setHover(null), []);

  const hoverPoint = hover ? data[hover.index] : null;

  return (
    <div>
      {hoverPoint && (
        <div className="text-xs text-zinc-500 mb-2 text-right">
          <span className="font-semibold text-zinc-900">${hoverPoint.price.toFixed(2)}</span>
          {hoverPoint.condition && (
            <span className="ml-1.5 text-zinc-400">{hoverPoint.condition}</span>
          )}
          <span className="ml-1.5">
            {new Date(hoverPoint.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        </div>
      )}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        className="w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <path
          d={linePath}
          fill="none"
          stroke="#a1a1aa"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        <text
          x={PADDING.left}
          y={PADDING.top + CHART_HEIGHT + 16}
          textAnchor="start"
          className="text-[10px]"
          fill="#d4d4d8"
        >
          {fmt(data[0].date)}
        </text>
        <text
          x={PADDING.left + CHART_WIDTH}
          y={PADDING.top + CHART_HEIGHT + 16}
          textAnchor="end"
          className="text-[10px]"
          fill="#d4d4d8"
        >
          {fmt(data[data.length - 1].date)}
        </text>

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
