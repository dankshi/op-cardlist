/** Trust band shown on the card-detail page below the Buy Now CTA.
 *  Three short reassurances that answer the buyer's top-of-mind concerns
 *  before they commit: what happens if it's wrong, what's our role in the
 *  middle, and what's the return path. Server-rendered (no client JS) so
 *  it doesn't add to the page's interactive footprint. */
export function TrustBadges() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Badge
        title="Nomi Promise"
        body="Every card passes through our hands. Authentic, condition-accurate, or your money back — no exceptions."
        accent="text-orange-600"
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 2.5l8.5 3v6.5c0 4.7-3.4 8.7-8.5 9.5-5.1-.8-8.5-4.8-8.5-9.5V5.5L12 2.5z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" />
          </svg>
        }
      />
      <Badge
        title="Our Process"
        body="Seller ships to Nomi → we verify and grade-check → we ship to you. You only pay once we confirm it's real."
        accent="text-blue-600"
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 12h3l3-7 4 14 3-7h5" />
          </svg>
        }
      />
      <Badge
        title="Return Policy"
        body="14 days to return if the card doesn't match its listing. Full refund credited to your wallet within 24 hours."
        accent="text-emerald-600"
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 12a9 9 0 1015-6.7L21 8" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 3v5h-5" />
          </svg>
        }
      />
    </div>
  )
}

function Badge({ title, body, icon, accent }: { title: string; body: string; icon: React.ReactNode; accent: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className={`flex items-center gap-2 mb-2 ${accent}`}>
        {icon}
        <span className="text-sm font-bold text-zinc-900">{title}</span>
      </div>
      <p className="text-xs text-zinc-500 leading-relaxed">{body}</p>
    </div>
  )
}
