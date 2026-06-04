/** Trust line shown in the card-detail action column, below the Buy/Offer
 *  CTAs. Three short reassurances that answer the buyer's top-of-mind
 *  concerns before they commit. Rendered as a single inline row (not boxed
 *  cards) so the action column stays a clean borderless stack.
 *  Server-rendered (no client JS) so it adds nothing to the interactive
 *  footprint. */
export function TrustBadges() {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-xs text-zinc-500">
      <Item accent="text-orange-500" label="Nomi Promise — money-back guarantee" />
      <Item accent="text-blue-500" label="We verify every card before it ships" />
      <Item accent="text-emerald-500" label="14-day returns to your wallet" />
    </div>
  )
}

function Item({ label, accent }: { label: string; accent: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg className={`w-3.5 h-3.5 flex-shrink-0 ${accent}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4l3.1 3.1 6.8-6.8a1 1 0 011.4 0z" clipRule="evenodd" />
      </svg>
      {label}
    </span>
  )
}
