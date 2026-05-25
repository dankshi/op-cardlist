import { TIERS, FULFILLMENT, RAW_MARKETPLACE_PERCENT, PROCESSING_PERCENT } from "@/lib/fees";

function formatPercent(n: number): string {
  return `${n}%`;
}

export function PricingTable() {
  // Elite + P2P are invite-only and hidden from public surfaces. Backend
  // still supports them for approved partners.
  const visibleTiers = TIERS.filter((t) => !t.isP2POnly);
  const visibleFulfillment = FULFILLMENT.filter((f) => !f.requiresElite);
  // Bar visualization scales fee % vs the worst case (Basic) so Diamond
  // looks visibly smaller. We invert (lower fee = fuller bar) so the visual
  // reads as "more take-home as you tier up."
  const maxFee = visibleTiers[0].marketplacePercent;
  const minFee = visibleTiers[visibleTiers.length - 1].marketplacePercent;
  const feeRange = maxFee - minFee;

  return (
    <section className="mb-12 sm:mb-16">
      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-100 text-zinc-700 text-xs font-semibold uppercase tracking-wider mb-4">
          Transparent pricing
        </div>
        <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-zinc-900 mb-3 tracking-tight">
          Sell more, keep more.
        </h2>
        <p className="text-zinc-500 max-w-xl mx-auto">
          Your fee drops the more you sell. No listing fees, no monthly subscription —
          one flat structure across every card.
        </p>
      </div>

      {/* Tier ladder */}
      <div className="mb-10">
        <div className="flex items-center justify-between mb-4 px-1">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Tier perks (slabs)
          </h3>
          <p className="text-xs text-zinc-400">Unlocks automatically by GMV</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {visibleTiers.map((tier) => {
            const fillPercent = feeRange > 0
              ? 30 + ((maxFee - tier.marketplacePercent) / feeRange) * 70
              : 100;
            return (
              <div
                key={tier.id}
                className={`rounded-xl p-5 border transition-colors ${
                  tier.highlight
                    ? 'bg-zinc-900 text-white border-zinc-900'
                    : 'bg-white text-zinc-900 border-zinc-200'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className={`text-[11px] uppercase tracking-[0.14em] font-semibold ${
                    tier.highlight ? 'text-zinc-400' : 'text-zinc-500'
                  }`}>
                    {tier.name}
                  </div>
                  {tier.isP2POnly && (
                    <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                      tier.highlight ? 'bg-white/10 text-white' : 'bg-zinc-100 text-zinc-500'
                    }`}>
                      P2P
                    </span>
                  )}
                </div>
                <div className="text-3xl font-bold tabular-nums tracking-tight">
                  {formatPercent(tier.marketplacePercent)}
                </div>
                <div className={`text-[11px] mt-1 ${tier.highlight ? 'text-zinc-400' : 'text-zinc-500'}`}>
                  marketplace fee
                </div>
                {/* Fill bar */}
                <div className={`mt-4 h-1.5 rounded-full overflow-hidden ${
                  tier.highlight ? 'bg-white/15' : 'bg-zinc-100'
                }`}>
                  <div
                    className={`h-full rounded-full transition-all ${
                      tier.highlight ? 'bg-emerald-400' : 'bg-zinc-900'
                    }`}
                    style={{ width: `${fillPercent}%` }}
                  />
                </div>
                <div className={`text-[11px] mt-3 tabular-nums ${tier.highlight ? 'text-zinc-300' : 'text-zinc-600'}`}>
                  {tier.gmvRange}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Raw card callout */}
      <div className="mb-10 rounded-2xl border border-amber-200 bg-amber-50 p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h3 className="text-base font-semibold text-amber-900">
              Raw cards stay at {RAW_MARKETPLACE_PERCENT}% — every tier.
            </h3>
          </div>
          <p className="text-sm text-amber-800/80 mt-1 leading-relaxed">
            Ungraded cards take longer to authenticate and carry more risk in transit.
            Tier discounts apply only to slabs.
          </p>
        </div>
      </div>

      {/* Fulfillment methods */}
      <div className="mb-4 px-1">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          How you get your cards to us
        </h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {visibleFulfillment.map((method) => (
          <div
            key={method.id}
            className="rounded-xl bg-white border border-zinc-200 p-5"
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="text-base font-semibold text-zinc-900">
                  {method.name}
                </div>
                <div className="text-xs text-zinc-500 mt-0.5">{method.tagline}</div>
              </div>
              {method.requiresElite && (
                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-yellow-100 text-yellow-800 font-semibold shrink-0">
                  Elite only
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold tabular-nums text-zinc-900">
                {method.sellerFee === 0 ? 'Free' : `$${method.sellerFee.toFixed(2)}`}
              </span>
              <span className="text-xs text-zinc-500">
                platform fee per card
              </span>
            </div>
            <div className="mt-3 pt-3 border-t border-zinc-100 text-xs text-zinc-500">
              Best for: <span className="text-zinc-700">{method.bestFor}</span>
            </div>
          </div>
        ))}
      </div>

      <p className="text-center text-xs text-zinc-400 mt-6">
        Plus a flat {PROCESSING_PERCENT}% payment-processing fee on every sale.
      </p>
    </section>
  );
}
