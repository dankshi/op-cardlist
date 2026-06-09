'use client'

import { useState, useRef, useCallback } from 'react'
import type { Range, ValuePoint } from '@/lib/collection-history'

const RANGES: Range[] = ['1W', '1M', '3M', '1Y', 'All']

const SVG_WIDTH = 800
const SVG_HEIGHT = 200
const PADDING = { top: 12, right: 12, bottom: 24, left: 12 }
const CHART_WIDTH = SVG_WIDTH - PADDING.left - PADDING.right
const CHART_HEIGHT = SVG_HEIGHT - PADDING.top - PADDING.bottom

function fmtUSD(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Robinhood-style portfolio value line with range tabs. Adapts the SVG line
 *  + hover logic from PriceHistoryChart; stroke is tinted green/red by whether
 *  the range ended up over its start, and the hover reports value + date. */
export function PortfolioChart({
  series,
  range,
  onRangeChange,
  loading,
}: {
  series: ValuePoint[]
  range: Range
  onRangeChange: (r: Range) => void
  loading: boolean
}) {
  const [hover, setHover] = useState<{ x: number; index: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const enough = series.length >= 2
  const values = series.map(d => d.value)
  const minV = enough ? Math.min(...values) : 0
  const maxV = enough ? Math.max(...values) : 0
  const vRange = maxV - minV || 1
  const yPad = vRange * 0.15
  const yMin = minV - yPad
  const yMax = maxV + yPad

  const minTime = enough ? new Date(series[0].date).getTime() : 0
  const maxTime = enough ? new Date(series[series.length - 1].date).getTime() : 1
  const timeRange = maxTime - minTime || 1

  const toX = (date: string) =>
    PADDING.left + ((new Date(date).getTime() - minTime) / timeRange) * CHART_WIDTH
  const toY = (v: number) =>
    PADDING.top + (1 - (v - yMin) / (yMax - yMin)) * CHART_HEIGHT

  const up = enough ? series[series.length - 1].value >= series[0].value : true
  const stroke = up ? '#059669' : '#dc2626' // emerald-600 / red-600

  const linePath = enough
    ? series.map((d, i) => `${i === 0 ? 'M' : 'L'}${toX(d.date).toFixed(1)},${toY(d.value).toFixed(1)}`).join(' ')
    : ''

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current || series.length === 0) return
      const rect = svgRef.current.getBoundingClientRect()
      const mouseX = ((e.clientX - rect.left) / rect.width) * SVG_WIDTH
      let nearest = 0
      let best = Infinity
      for (let i = 0; i < series.length; i++) {
        const dist = Math.abs(toX(series[i].date) - mouseX)
        if (dist < best) { best = dist; nearest = i }
      }
      setHover({ x: toX(series[nearest].date), index: nearest })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series],
  )

  const hoverPoint = hover ? series[hover.index] : null

  return (
    <div>
      <div className="h-5 mb-1 text-xs text-zinc-500 text-right">
        {hoverPoint && (
          <>
            <span className="font-semibold text-zinc-900 tabular-nums">{fmtUSD(hoverPoint.value)}</span>
            <span className="ml-1.5">
              {new Date(hoverPoint.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          </>
        )}
      </div>

      <div className="relative">
        {enough ? (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
            className="w-full h-auto"
            preserveAspectRatio="xMidYMid meet"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHover(null)}
          >
            <path d={linePath} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            {hover && hoverPoint && (
              <>
                <line x1={hover.x} y1={PADDING.top} x2={hover.x} y2={PADDING.top + CHART_HEIGHT} stroke="#d4d4d8" strokeWidth="1" />
                <circle cx={hover.x} cy={toY(hoverPoint.value)} r="4" fill="#18181b" stroke="white" strokeWidth="2" />
              </>
            )}
          </svg>
        ) : (
          <div className="flex items-center justify-center text-sm text-zinc-400" style={{ aspectRatio: `${SVG_WIDTH} / ${SVG_HEIGHT}` }}>
            Not enough price history yet — your value line builds as prices update.
          </div>
        )}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/40">
            <div className="w-5 h-5 border-2 border-zinc-300 border-t-zinc-600 rounded-full animate-spin" />
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 mt-3">
        {RANGES.map(r => (
          <button
            key={r}
            type="button"
            onClick={() => onRangeChange(r)}
            className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
              r === range ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:bg-zinc-100'
            }`}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  )
}
