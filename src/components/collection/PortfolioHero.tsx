function fmtUSD(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function signed(n: number) {
  return `${n >= 0 ? '+' : '−'}${fmtUSD(Math.abs(n))}`
}

/** Robinhood-style portfolio header: big current value, unrealized gain/loss in
 *  $ and %, and (once any sales are recorded) realized + total-return figures.
 *  Unrealized gain is over the invested (known-cost) portion. */
export function PortfolioHero({
  totalValue,
  totalGain,
  totalGainPct,
  cardCount,
  uniqueCount,
  realizedGain = 0,
}: {
  totalValue: number
  totalGain: number
  totalGainPct: number | null
  cardCount: number
  uniqueCount: number
  realizedGain?: number
}) {
  const hasGain = totalGainPct != null && Math.abs(totalGain) >= 0.005
  const up = totalGain >= 0
  const gainColor = !hasGain ? 'text-zinc-500' : up ? 'text-emerald-400' : 'text-red-400'
  const sign = up ? '+' : '−'

  const hasRealized = Math.abs(realizedGain) >= 0.005
  const totalReturn = totalGain + realizedGain

  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Collection value</p>
      <p className="text-4xl md:text-5xl font-light tabular-nums tracking-tight text-zinc-100 mt-1 leading-none">
        {fmtUSD(totalValue)}
      </p>
      <div className="mt-2 flex items-center gap-3 text-sm">
        <span className={`font-semibold tabular-nums ${gainColor}`}>
          {hasGain
            ? `${sign}${fmtUSD(Math.abs(totalGain))} (${sign}${(Math.abs(totalGainPct!) * 100).toFixed(2)}%)`
            : '—'}
          <span className="font-normal text-zinc-400"> unrealized</span>
        </span>
      </div>

      {hasRealized && (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
          <span className="tabular-nums">
            <span className="text-zinc-400">Realized </span>
            <span className={`font-semibold ${realizedGain >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{signed(realizedGain)}</span>
          </span>
          <span className="tabular-nums">
            <span className="text-zinc-400">Total return </span>
            <span className={`font-semibold ${totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{signed(totalReturn)}</span>
          </span>
        </div>
      )}

      <p className="mt-2 text-xs text-zinc-400 tabular-nums">
        {cardCount} {cardCount === 1 ? 'card' : 'cards'} · {uniqueCount} unique
      </p>
    </div>
  )
}
