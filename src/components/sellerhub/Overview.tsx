'use client'

import Link from 'next/link'
import type { Profile, Listing, Order } from '@/types/database'
import { getTier } from '@/lib/fees'
import type { SellerHubTab } from './SellerHubClient'

interface Props {
  profile: Profile
  listings: Listing[]
  orders: Order[]
  onNavigate: (tab: SellerHubTab) => void
}

/** At-a-glance tiles, modeled on the admin dashboard's queue tiles. Each
 *  tile either deep-links elsewhere or jumps to a Seller Hub tab. */
export function Overview({ profile, listings, orders, onNavigate }: Props) {
  const activeListings = listings.filter(l => l.status === 'active')
  const pendingSales = orders.filter(o => ['paid', 'seller_shipped', 'received', 'authenticated'].includes(o.status))
  const needsLabel = orders.filter(o => o.status === 'paid' && !o.seller_label_url)
  const tier = (() => { try { return getTier(profile.seller_tier) } catch { return null } })()

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Tile
          label="Balance"
          value={`$${Number(profile.balance || 0).toFixed(2)}`}
          tone="emerald"
          href="/wallet"
          cta="View wallet →"
          hint="Credits from sales"
        />
        <Tile
          label="Active listings"
          value={activeListings.length}
          tone="orange"
          onClick={() => onNavigate('inventory')}
          cta="Manage inventory →"
        />
        <Tile
          label="Pending sales"
          value={pendingSales.length}
          tone="amber"
          onClick={() => onNavigate('orders')}
          cta="View orders →"
          hint={needsLabel.length > 0 ? `${needsLabel.length} need a label` : undefined}
        />
        <Tile
          label="Lifetime GMV"
          value={`$${Number(profile.seller_gmv || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          tone="blue"
        />
        <Tile
          label="Seller tier"
          value={tier?.name ?? profile.seller_tier}
          tone="purple"
          hint={tier ? `${tier.marketplacePercent}% on graded` : undefined}
        />
      </div>

      {/* Quick actions */}
      <div className="bg-white border border-zinc-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-zinc-900 mb-3">Quick actions</h2>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onNavigate('add')}
            className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition-colors cursor-pointer"
          >
            + Bulk create listings
          </button>
          <button
            onClick={() => onNavigate('inventory')}
            className="px-4 py-2 rounded-lg border border-zinc-200 text-zinc-700 hover:bg-zinc-50 text-sm font-semibold transition-colors cursor-pointer"
          >
            Bulk price update
          </button>
          <button
            onClick={() => onNavigate('offers')}
            className="px-4 py-2 rounded-lg border border-zinc-200 text-zinc-700 hover:bg-zinc-50 text-sm font-semibold transition-colors cursor-pointer"
          >
            Review offers
          </button>
          <Link
            href="/sell"
            className="px-4 py-2 rounded-lg border border-zinc-200 text-zinc-700 hover:bg-zinc-50 text-sm font-semibold transition-colors"
          >
            Single listing wizard →
          </Link>
        </div>
      </div>
    </div>
  )
}

type Tone = 'orange' | 'amber' | 'emerald' | 'blue' | 'purple'

const TONE: Record<Tone, { bg: string; ring: string; value: string }> = {
  orange: { bg: 'bg-orange-50', ring: 'ring-orange-200', value: 'text-orange-600' },
  amber: { bg: 'bg-amber-50', ring: 'ring-amber-200', value: 'text-amber-600' },
  emerald: { bg: 'bg-emerald-50', ring: 'ring-emerald-200', value: 'text-emerald-600' },
  blue: { bg: 'bg-blue-50', ring: 'ring-blue-200', value: 'text-blue-600' },
  purple: { bg: 'bg-purple-50', ring: 'ring-purple-200', value: 'text-purple-600' },
}

function Tile({
  label, value, tone, href, onClick, cta, hint,
}: {
  label: string
  value: string | number
  tone: Tone
  href?: string
  onClick?: () => void
  cta?: string
  hint?: string
}) {
  const c = TONE[tone]
  const inner = (
    <>
      <p className="text-xs uppercase tracking-wide text-zinc-500 font-semibold">{label}</p>
      <p className={`text-3xl font-light tabular-nums mt-1 ${c.value}`}>{value}</p>
      {hint && <p className="text-[11px] text-zinc-400 mt-1">{hint}</p>}
      {cta && <p className={`text-xs font-semibold mt-3 ${c.value}`}>{cta}</p>}
    </>
  )
  const cls = `block text-left p-4 rounded-xl ring-1 transition-all ${c.bg} ${c.ring} ${(href || onClick) ? 'hover:shadow-sm cursor-pointer' : ''}`

  if (href) return <Link href={href} className={cls}>{inner}</Link>
  if (onClick) return <button onClick={onClick} className={cls}>{inner}</button>
  return <div className={cls}>{inner}</div>
}
