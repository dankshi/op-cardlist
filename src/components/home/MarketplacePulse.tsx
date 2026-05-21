interface PulseProps {
  activeListings: number;
  listingsLast24h: number;
  ordersShippedLast30d: number;
  avgListingPrice: number | null;
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return n.toLocaleString('en-US');
}

function formatPrice(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function MarketplacePulse({
  activeListings,
  listingsLast24h,
  ordersShippedLast30d,
  avgListingPrice,
}: PulseProps) {
  // Hide the section entirely if there's nothing real to show.
  if (activeListings === 0 && listingsLast24h === 0 && ordersShippedLast30d === 0) {
    return null;
  }

  const cells = [
    { label: 'Active listings', value: formatCount(activeListings) },
    { label: 'Listed in last 24h', value: formatCount(listingsLast24h) },
    { label: 'Shipped in last 30d', value: formatCount(ordersShippedLast30d) },
    {
      label: 'Avg listing price',
      value: avgListingPrice != null ? formatPrice(avgListingPrice) : '—',
    },
  ];

  return (
    <section className="mb-12 sm:mb-16">
      <div className="rounded-2xl bg-zinc-900 text-white px-6 py-8 sm:px-10 sm:py-10">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6 mb-8">
          <div>
            <div className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-emerald-400 font-semibold mb-3">
              <span className="relative flex w-2 h-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full w-2 h-2 bg-emerald-400" />
              </span>
              Live marketplace
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              The market, right now.
            </h2>
          </div>
          <p className="text-sm text-zinc-400 max-w-sm sm:text-right">
            Real activity from real sellers, updated every page load.
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-zinc-800 rounded-xl overflow-hidden">
          {cells.map((cell) => (
            <div key={cell.label} className="bg-zinc-900 px-4 py-5 sm:px-5 sm:py-6">
              <div className="text-2xl sm:text-3xl font-bold tracking-tight tabular-nums">
                {cell.value}
              </div>
              <div className="text-[11px] uppercase tracking-wider text-zinc-400 font-medium mt-1">
                {cell.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
