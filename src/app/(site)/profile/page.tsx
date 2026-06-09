import Link from 'next/link'
import { requireUser, getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { getTier } from '@/lib/fees'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'My Profile',
  robots: { index: false },
}

/** Run a head-only count query, returning 0 on any error so one failed
 *  stat never blanks the whole page. */
async function countRows(
  table: string,
  filters: Record<string, string | string[]>,
): Promise<number> {
  const supabase = await createClient()
  let query = supabase.from(table).select('*', { count: 'exact', head: true })
  for (const [col, val] of Object.entries(filters)) {
    query = Array.isArray(val) ? query.in(col, val) : query.eq(col, val)
  }
  const { count, error } = await query
  return error ? 0 : count ?? 0
}

export default async function ProfilePage() {
  const user = await requireUser()
  const profile = await getProfile(user.id)

  if (!profile) {
    return (
      <div className="text-center py-20">
        <p className="text-zinc-500">Profile not found. Please try signing out and back in.</p>
      </div>
    )
  }

  const isSeller = profile.is_seller && profile.seller_approved
  const tier = (() => {
    try {
      return getTier(profile.seller_tier)
    } catch {
      return null
    }
  })()

  // Stats computed across related tables. Seller-only counts are skipped
  // for non-sellers to avoid pointless queries.
  const [collectionCount, purchaseCount, activeListings] = await Promise.all([
    countRows('collections', { user_id: user.id }),
    countRows('orders', { buyer_id: user.id, status: ['delivered', 'shipped_to_buyer'] }),
    isSeller ? countRows('listings', { seller_id: user.id, status: 'active' }) : Promise.resolve(0),
  ])

  const hasAddress = Boolean(
    profile.shipping_street1 || profile.shipping_city || profile.shipping_state || profile.shipping_zip,
  )

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-zinc-900">My Profile</h1>
        <Link
          href="/profile/edit"
          className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition-colors"
        >
          Edit Profile
        </Link>
      </div>

      {/* Identity card */}
      <div className="bg-white border border-zinc-200 rounded-2xl p-8 mb-6">
        <div className="flex items-center gap-6">
          {profile.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.avatar_url} alt="" className="w-20 h-20 rounded-full object-cover" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-orange-500 flex items-center justify-center text-white text-2xl font-bold">
              {(profile.display_name || 'U')[0].toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-zinc-900">{profile.display_name || 'Anonymous'}</h2>
            {profile.username && <p className="text-zinc-500">@{profile.username}</p>}
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {isSeller && (
                <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-green-500/10 text-green-600 border border-green-500/20">
                  Verified Seller
                </span>
              )}
              {isSeller && tier && (
                <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-purple-500/10 text-purple-600 border border-purple-500/20">
                  {tier.name} tier
                </span>
              )}
              {profile.is_admin && (
                <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-zinc-900 text-white">
                  Admin
                </span>
              )}
            </div>
          </div>
        </div>

        {profile.bio && (
          <div className="mt-6 pt-6 border-t border-zinc-100">
            <h3 className="text-sm font-medium text-zinc-500 mb-1">Bio</h3>
            <p className="text-zinc-800 whitespace-pre-line">{profile.bio}</p>
          </div>
        )}

        <div className="mt-6 pt-6 border-t border-zinc-100 text-sm text-zinc-500">
          Member since{' '}
          {new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </div>
      </div>

      {/* Stats */}
      <h2 className="text-lg font-semibold text-zinc-900 mb-3">Your stats</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-8">
        <Stat label="Collection" value={collectionCount} hint="cards tracked" tone="blue" />
        <Stat label="Purchases" value={purchaseCount} hint="orders received" tone="emerald" />
        <Stat
          label="Rating"
          value={profile.rating_avg > 0 ? profile.rating_avg.toFixed(1) : '—'}
          hint={`${profile.rating_count} review${profile.rating_count === 1 ? '' : 's'}`}
          tone="amber"
        />
        {isSeller ? (
          <>
            <Stat label="Sales" value={profile.total_sales} hint="completed" tone="orange" />
            <Stat label="Active listings" value={activeListings} hint="for sale now" tone="orange" />
            <Stat
              label="Balance"
              value={`$${Number(profile.balance || 0).toFixed(2)}`}
              hint="from sales"
              tone="emerald"
            />
            <Stat
              label="Lifetime GMV"
              value={`$${Number(profile.seller_gmv || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
              hint={tier ? `${tier.marketplacePercent}% fee on graded` : undefined}
              tone="purple"
            />
          </>
        ) : (
          <Stat label="Sales" value={profile.total_sales} hint="completed" tone="orange" />
        )}
      </div>

      {/* Address & contact */}
      <div className="bg-white border border-zinc-200 rounded-2xl p-8 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-zinc-900">Address &amp; contact</h2>
          <Link href="/profile/edit" className="text-sm font-medium text-orange-500 hover:text-orange-600">
            Edit
          </Link>
        </div>

        {hasAddress || profile.shipping_phone ? (
          <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
            <Field label="Shipping address">
              {hasAddress ? (
                <span className="not-italic">
                  {profile.shipping_street1 && (
                    <>
                      {profile.shipping_street1}
                      <br />
                    </>
                  )}
                  {[profile.shipping_city, profile.shipping_state].filter(Boolean).join(', ')}
                  {profile.shipping_zip ? ` ${profile.shipping_zip}` : ''}
                </span>
              ) : (
                <span className="text-zinc-400">Not set</span>
              )}
            </Field>
            <Field label="Phone">
              {profile.shipping_phone || <span className="text-zinc-400">Not set</span>}
            </Field>
            <Field label="Contact email">
              {profile.shipping_email || user.email || <span className="text-zinc-400">Not set</span>}
            </Field>
          </dl>
        ) : (
          <p className="text-sm text-zinc-500">
            You haven&apos;t added a shipping address yet.{' '}
            <Link href="/profile/edit" className="text-orange-500 hover:text-orange-600 font-medium">
              Add one now
            </Link>{' '}
            so orders ship to the right place.
          </p>
        )}
      </div>

      {/* Account details */}
      <div className="bg-white border border-zinc-200 rounded-2xl p-8 mb-6">
        <h2 className="text-lg font-semibold text-zinc-900 mb-4">Account</h2>
        <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
          <Field label="Email">{user.email || <span className="text-zinc-400">—</span>}</Field>
          <Field label="Username">
            {profile.username ? `@${profile.username}` : <span className="text-zinc-400">Not set</span>}
          </Field>
          {isSeller && (
            <Field label="Storefront">
              <Link
                href={`/seller/${profile.username ?? ''}`}
                className="text-orange-500 hover:text-orange-600 font-medium"
              >
                View public storefront →
              </Link>
            </Field>
          )}
          <Field label="Member since">
            {new Date(profile.created_at).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </Field>
        </dl>
      </div>

      {!profile.is_seller && (
        <div className="p-4 bg-orange-500/5 border border-orange-500/20 rounded-lg">
          <p className="text-zinc-600 text-sm">
            Want to sell cards on NOMI Market?{' '}
            <Link href="/seller/apply" className="text-orange-500 hover:text-orange-600 font-medium">
              Become a seller
            </Link>
          </p>
        </div>
      )}
    </div>
  )
}

type Tone = 'orange' | 'amber' | 'emerald' | 'blue' | 'purple'

const TONE: Record<Tone, string> = {
  orange: 'text-orange-600',
  amber: 'text-amber-600',
  emerald: 'text-emerald-600',
  blue: 'text-blue-600',
  purple: 'text-purple-600',
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string | number
  hint?: string
  tone: Tone
}) {
  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-4">
      <p className="text-xs uppercase tracking-wide text-zinc-500 font-semibold">{label}</p>
      <p className={`text-3xl font-light tabular-nums mt-1 ${TONE[tone]}`}>{value}</p>
      {hint && <p className="text-[11px] text-zinc-400 mt-1">{hint}</p>}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-zinc-500 mb-0.5">{label}</dt>
      <dd className="text-zinc-900 font-medium">{children}</dd>
    </div>
  )
}
