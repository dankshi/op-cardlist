"use client";

import { useState } from "react";
import Link from "next/link";
import {
  TIERS,
  FULFILLMENT,
  calculatePayout,
  type FulfillmentId,
  type TierId,
} from "@/lib/fees";

// Elite + P2P are invite-only for partners and hidden from public surfaces.
const PUBLIC_FULFILLMENT = FULFILLMENT.filter((f) => !f.requiresElite);
const PUBLIC_TIERS = TIERS.filter((t) => !t.isP2POnly);

const PRESETS = [25, 50, 100, 250, 500];

function formatUSD(n: number, decimals: number = 2): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

export function PayoutCalculator() {
  const [raw, setRaw] = useState<string>('100');
  const [fulfillment, setFulfillment] = useState<FulfillmentId>('ship');
  const [tier, setTier] = useState<TierId>('basic');
  const [isRaw, setIsRaw] = useState<boolean>(false);

  const sale = (() => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  })();

  const result = calculatePayout({
    salePrice: sale,
    fulfillment,
    tier,
    isRaw,
  });

  return (
    <section className="mb-12 sm:mb-16">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 sm:p-8 lg:p-10">
        <div className="mb-8 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-100 text-zinc-700 text-xs font-semibold uppercase tracking-wider mb-3">
            Payout calculator
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-zinc-900 tracking-tight">
            See exactly what you&apos;ll take home.
          </h2>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-8 items-stretch">
          {/* Inputs */}
          <div className="space-y-6">
            {/* Sale price */}
            <div>
              <label htmlFor="sale-price" className="block text-[11px] uppercase tracking-[0.14em] text-zinc-500 font-semibold mb-2">
                Sale price
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 text-xl font-semibold">$</span>
                <input
                  id="sale-price"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={raw}
                  onChange={(e) => setRaw(e.target.value)}
                  className="w-full pl-9 pr-4 py-3 bg-white border border-zinc-200 rounded-lg text-xl font-semibold tabular-nums text-zinc-900 focus:outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 transition-all"
                  placeholder="100"
                />
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                {PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setRaw(String(p))}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      sale === p
                        ? 'bg-zinc-900 text-white'
                        : 'bg-white text-zinc-600 ring-1 ring-zinc-200 hover:ring-zinc-400'
                    }`}
                  >
                    ${p}
                  </button>
                ))}
              </div>
            </div>

            {/* Card type */}
            <div>
              <label className="block text-[11px] uppercase tracking-[0.14em] text-zinc-500 font-semibold mb-2">
                Card type
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: false, label: 'Slab', sub: 'Graded' },
                  { id: true, label: 'Raw', sub: 'Ungraded' },
                ].map((opt) => {
                  const selected = isRaw === opt.id;
                  return (
                    <button
                      key={String(opt.id)}
                      type="button"
                      onClick={() => setIsRaw(opt.id)}
                      className={`px-4 py-3 rounded-lg border text-left transition-colors ${
                        selected
                          ? 'border-zinc-900 bg-zinc-900 text-white'
                          : 'border-zinc-200 bg-white text-zinc-900 hover:border-zinc-400'
                      }`}
                    >
                      <div className="text-sm font-semibold">{opt.label}</div>
                      <div className={`text-xs mt-0.5 ${selected ? 'text-zinc-400' : 'text-zinc-500'}`}>
                        {opt.sub}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Fulfillment */}
            <div>
              <label className="block text-[11px] uppercase tracking-[0.14em] text-zinc-500 font-semibold mb-2">
                Fulfillment
              </label>
              <div className="grid grid-cols-2 gap-2">
                {PUBLIC_FULFILLMENT.map((f) => {
                  const selected = fulfillment === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFulfillment(f.id)}
                      className={`px-3 py-2.5 rounded-lg border text-left transition-colors ${
                        selected
                          ? 'border-zinc-900 bg-zinc-900 text-white'
                          : 'border-zinc-200 bg-white text-zinc-900 hover:border-zinc-400'
                      }`}
                    >
                      <div className="text-sm font-semibold leading-tight">{f.name}</div>
                      <div className={`text-[11px] mt-0.5 ${selected ? 'text-zinc-400' : 'text-zinc-500'}`}>
                        {f.sellerFee === 0 ? 'No seller fee' : `${formatUSD(f.sellerFee, 0)} seller fee`}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Tier — hidden for raw (locked at 9.5%) */}
            <div className={isRaw ? 'opacity-50 pointer-events-none' : ''}>
              <label htmlFor="tier-select" className="block text-[11px] uppercase tracking-[0.14em] text-zinc-500 font-semibold mb-2">
                Seller tier
                {isRaw && <span className="ml-2 normal-case text-zinc-400 text-[10px] tracking-normal">— locked at 9.5% for raw</span>}
              </label>
              <div className="relative">
                <select
                  id="tier-select"
                  value={tier}
                  onChange={(e) => setTier(e.target.value as TierId)}
                  disabled={isRaw}
                  className="w-full appearance-none pl-4 pr-10 py-3 rounded-lg border border-zinc-200 bg-white text-sm font-medium text-zinc-900 hover:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 cursor-pointer disabled:cursor-not-allowed"
                >
                  {PUBLIC_TIERS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} — {t.marketplacePercent}% ({t.gmvRange})
                    </option>
                  ))}
                </select>
                <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="hidden lg:block w-px bg-zinc-200" />

          {/* Output */}
          <div className="rounded-xl bg-zinc-50 border border-zinc-200 p-5 sm:p-6 flex flex-col">
            <div className="text-[11px] uppercase tracking-[0.14em] text-zinc-500 font-semibold mb-1">
              Breakdown
            </div>
            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-zinc-500">Sale price</dt>
                <dd className="text-zinc-900 tabular-nums">{formatUSD(result.salePrice)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-zinc-500">Seller fee</dt>
                <dd className={`tabular-nums ${result.sellerFee > 0 ? 'text-rose-600' : 'text-zinc-400'}`}>
                  {result.sellerFee > 0 ? `−${formatUSD(result.sellerFee)}` : 'Free'}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-zinc-500">Marketplace ({result.marketplacePercent}%)</dt>
                <dd className="text-rose-600 tabular-nums">−{formatUSD(result.marketplaceFee)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-zinc-500">Processing ({result.processingPercent}%)</dt>
                <dd className="text-rose-600 tabular-nums">−{formatUSD(result.processingFee)}</dd>
              </div>
            </dl>
            <div className="h-px bg-zinc-200 my-4" />
            <div className="flex items-end justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-[0.14em] text-zinc-500 font-semibold">
                  You receive
                </div>
                {sale > 0 && (
                  <div className="text-[11px] text-zinc-400 mt-0.5 tabular-nums">
                    {(result.payoutRatio * 100).toFixed(1)}% of sale
                  </div>
                )}
              </div>
              <div className="text-3xl font-bold text-emerald-600 tabular-nums tracking-tight">
                {formatUSD(result.payout)}
              </div>
            </div>
            <Link
              href="/sell"
              className="mt-6 w-full inline-flex items-center justify-center gap-2 px-5 py-3 bg-zinc-900 text-white text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors"
            >
              List a card
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
