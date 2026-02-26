import { notFound } from 'next/navigation'
import { getProfileByUsername } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { ConditionBadge } from '@/components/marketplace/ConditionBadge'
import { AddToCartButton } from '@/components/marketplace/AddToCartButton'
import type { Metadata } from 'next'
import type { Listing } from '@/types/database'

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
  const { username } = await params
  const profile = await getProfileByUsername(username)
  if (!profile) return { title: 'Seller Not Found' }

  return {
    title: `${profile.display_name || username} - Seller on NOMI Market`,
    description: profile.bio || `Browse cards for sale by ${profile.display_name || username} on NOMI Market`,
  }
}

export default async function SellerStorefrontPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params
  const profile = await getProfileByUsername(username)

  if (!profile || !profile.is_seller) {
    notFound()
  }

  const supabase = await createClient()
  const { data: listings } = await supabase
    .from('listings')
    .select('*')
    .eq('seller_id', profile.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })

  const { data: reviews } = await supabase
    .from('reviews')
    .select('*, reviewer:profiles(display_name)')
    .eq('seller_id', profile.id)
    .order('created_at', { ascending: false })
    .limit(5)

  return (
    <div>
      {/* Seller header */}
      <div className="bg-white border border-zinc-200 rounded-2xl p-8 mb-8">
        <div className="flex items-center gap-6">
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt="" className="w-20 h-20 rounded-full" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-orange-500 flex items-center justify-center text-white text-2xl font-bold">
              {(profile.display_name || 'S')[0].toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="text-2xl font-bold text-zinc-900">{profile.display_name}</h1>
            <p className="text-zinc-500">@{profile.username}</p>
            <div className="flex items-center gap-4 mt-2 text-sm">
              {profile.rating_count > 0 && (
                <span className="text-yellow-400">
                  {'★'.repeat(Math.round(profile.rating_avg))} {profile.rating_avg.toFixed(1)} ({profile.rating_count} reviews)
                </span>
              )}
              <span className="text-zinc-500">{profile.total_sales} sales</span>
              <span className="text-zinc-500">
                Member since {new Date(profile.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
              </span>
            </div>
          </div>
        </div>
        {profile.bio && <p className="text-zinc-600 mt-4">{profile.bio}</p>}
      </div>

      {/* Listings */}
      <h2 className="text-xl font-semibold text-zinc-900 mb-4">
        Cards for Sale ({(listings as Listing[])?.length || 0})
      </h2>

      {!listings?.length ? (
        <p className="text-zinc-500 text-center py-8">This seller has no active listings.</p>
      ) : (
        <div className="space-y-2">
          {(listings as Listing[]).map(listing => (
            <div key={listing.id} className="flex items-center justify-between p-4 rounded-lg bg-white border border-zinc-200">
              <div>
                <p className="font-medium text-zinc-900">{listing.title}</p>
                <div className="flex items-center gap-2 mt-1">
                  <ConditionBadge condition={listing.condition} />
                  {listing.quantity_available > 1 && (
                    <span className="text-xs text-zinc-500">{listing.quantity_available} available</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <p className="text-lg font-bold text-zinc-900">${Number(listing.price).toFixed(2)}</p>
                <AddToCartButton listingId={listing.id} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent Reviews */}
      {reviews && reviews.length > 0 && (
        <div className="mt-12">
          <h2 className="text-xl font-semibold text-zinc-900 mb-4">Recent Reviews</h2>
          <div className="space-y-3">
            {reviews.map((review: { id: string; rating: number; comment: string | null; created_at: string; reviewer: { display_name: string } | null }) => (
              <div key={review.id} className="p-4 rounded-lg bg-white border border-zinc-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-yellow-400">{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</span>
                  <span className="text-xs text-zinc-500">{new Date(review.created_at).toLocaleDateString()}</span>
                </div>
                {review.comment && <p className="text-zinc-600 text-sm">{review.comment}</p>}
                <p className="text-xs text-zinc-500 mt-2">&mdash; {review.reviewer?.display_name || 'Anonymous'}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
