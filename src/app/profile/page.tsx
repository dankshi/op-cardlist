import Link from 'next/link'
import { requireUser, getProfile } from '@/lib/auth'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'My Profile',
  robots: { index: false },
}

export default async function ProfilePage() {
  const user = await requireUser()
  const profile = await getProfile(user.id)

  if (!profile) {
    return (
      <div className="text-center py-20">
        <p className="text-zinc-400 light:text-gray-500">Profile not found. Please try signing out and back in.</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-zinc-100 light:text-gray-900">My Profile</h1>
        <Link
          href="/profile/edit"
          className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-500 text-white text-sm font-semibold transition-colors"
        >
          Edit Profile
        </Link>
      </div>

      <div className="bg-zinc-900 light:bg-white border border-zinc-800 light:border-gray-200 rounded-2xl p-8">
        <div className="flex items-center gap-6 mb-8">
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt="" className="w-20 h-20 rounded-full" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-orange-500 flex items-center justify-center text-white text-2xl font-bold">
              {(profile.display_name || 'U')[0].toUpperCase()}
            </div>
          )}
          <div>
            <h2 className="text-xl font-bold text-zinc-100 light:text-gray-900">{profile.display_name || 'Anonymous'}</h2>
            {profile.username && (
              <p className="text-zinc-400 light:text-gray-500">@{profile.username}</p>
            )}
            {profile.is_seller && profile.seller_approved && (
              <span className="inline-block mt-1 px-2 py-0.5 rounded text-xs font-semibold bg-green-500/10 text-green-400 border border-green-500/20">
                Verified Seller
              </span>
            )}
          </div>
        </div>

        {profile.bio && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-zinc-400 light:text-gray-500 mb-1">Bio</h3>
            <p className="text-zinc-200 light:text-gray-800">{profile.bio}</p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-zinc-800 light:bg-gray-100 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-zinc-100 light:text-gray-900">{profile.total_sales}</p>
            <p className="text-xs text-zinc-400 light:text-gray-500">Sales</p>
          </div>
          <div className="bg-zinc-800 light:bg-gray-100 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-zinc-100 light:text-gray-900">
              {profile.rating_avg > 0 ? profile.rating_avg.toFixed(1) : '-'}
            </p>
            <p className="text-xs text-zinc-400 light:text-gray-500">Rating</p>
          </div>
          <div className="bg-zinc-800 light:bg-gray-100 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-zinc-100 light:text-gray-900">{profile.rating_count}</p>
            <p className="text-xs text-zinc-400 light:text-gray-500">Reviews</p>
          </div>
        </div>

        <div className="text-sm text-zinc-500 light:text-gray-400">
          Member since {new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </div>

        {!profile.is_seller && (
          <div className="mt-6 p-4 bg-orange-500/5 border border-orange-500/20 rounded-lg">
            <p className="text-zinc-300 light:text-gray-600 text-sm">
              Want to sell cards on NOMI Market?{' '}
              <Link href="/seller/apply" className="text-orange-400 hover:text-orange-300 light:hover:text-orange-500 font-medium">
                Become a seller
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
