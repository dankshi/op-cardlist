import { ConditionBadge } from './ConditionBadge'
import type { Listing } from '@/types/database'

/** Read-only row in the price ladder. Per-listing Buy buttons used to live
 *  here, but they made the right action ambiguous when the same card had
 *  multiple sellers at different prices. The single Buy CTA on the cheapest
 *  listing now lives in ListingsGrid's hero card — these rows are pure
 *  price-comparison context. */
export function ListingCard({ listing }: { listing: Listing }) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-white border border-zinc-200">
      <div className="flex items-center gap-2 min-w-0">
        <ConditionBadge condition={listing.condition} gradingCompany={listing.grading_company} grade={listing.grade} />
        {listing.language !== 'EN' && (
          <span className="px-1.5 py-0.5 rounded text-xs bg-zinc-200 text-zinc-600">{listing.language}</span>
        )}
        {listing.is_first_edition && (
          <span className="px-1.5 py-0.5 rounded text-xs bg-purple-500/10 text-purple-400 border border-purple-500/20">1st Ed</span>
        )}
      </div>

      <div className="text-right flex-shrink-0">
        <p className="text-base font-semibold text-zinc-900 tabular-nums">${Number(listing.price).toFixed(2)}</p>
        {listing.quantity_available > 1 && (
          <p className="text-xs text-zinc-500">{listing.quantity_available} available</p>
        )}
      </div>
    </div>
  )
}
