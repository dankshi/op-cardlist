import { ConditionBadge } from './ConditionBadge'
import { AddToCartButton } from './AddToCartButton'
import type { Listing } from '@/types/database'

export function ListingCard({ listing }: { listing: Listing }) {
  return (
    <div className="flex items-center justify-between p-4 rounded-lg bg-white border border-zinc-200 hover:border-zinc-300 transition-colors">
      <div className="flex items-center gap-4 min-w-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ConditionBadge condition={listing.condition} gradingCompany={listing.grading_company} grade={listing.grade} />
            {listing.language !== 'EN' && (
              <span className="px-1.5 py-0.5 rounded text-xs bg-zinc-200 text-zinc-600">{listing.language}</span>
            )}
            {listing.is_first_edition && (
              <span className="px-1.5 py-0.5 rounded text-xs bg-purple-500/10 text-purple-400 border border-purple-500/20">1st Ed</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 flex-shrink-0">
        <div className="text-right">
          <p className="text-lg font-bold text-zinc-900">${Number(listing.price).toFixed(2)}</p>
          {listing.quantity_available > 1 && (
            <p className="text-xs text-zinc-500">{listing.quantity_available} available</p>
          )}
        </div>
        <AddToCartButton listingId={listing.id} maxQuantity={listing.quantity_available} />
      </div>
    </div>
  )
}
