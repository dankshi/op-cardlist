'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { ConditionBadge } from '@/components/marketplace/ConditionBadge'
import type { Profile, Listing, Order } from '@/types/database'

type Tab = 'listings' | 'orders' | 'settings'

export default function DashboardPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [listings, setListings] = useState<Listing[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [tab, setTab] = useState<Tab>('listings')
  const [loading, setLoading] = useState(true)
  const [showBulkPrice, setShowBulkPrice] = useState(false)
  const [bulkAdjustment, setBulkAdjustment] = useState('-5')
  const [bulkUpdating, setBulkUpdating] = useState(false)
  const [marketPrices, setMarketPrices] = useState<Record<string, number>>({})
  const [cardImages, setCardImages] = useState<Record<string, string>>({})
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth/sign-in'); return }

      const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      if (!p?.is_seller) { router.push('/seller/apply'); return }
      setProfile(p as Profile)

      const { data: l } = await supabase
        .from('listings')
        .select('*')
        .eq('seller_id', user.id)
        .order('created_at', { ascending: false })
      const fetchedListings = (l as Listing[]) || []
      setListings(fetchedListings)

      // Fetch card images for listings
      const uniqueCardIds = [...new Set(fetchedListings.map(li => li.card_id))]
      const images: Record<string, string> = {}
      await Promise.all(
        uniqueCardIds.map(async (cardId) => {
          try {
            const res = await fetch(`/api/cards?id=${encodeURIComponent(cardId)}`)
            const data = await res.json()
            if (data.card?.imageUrl) {
              images[cardId] = data.card.imageUrl
            }
          } catch { /* skip */ }
        })
      )
      setCardImages(images)

      const { data: o } = await supabase
        .from('orders')
        .select('*, buyer:profiles!orders_buyer_id_fkey(display_name), items:order_items(*)')
        .eq('seller_id', user.id)
        .order('created_at', { ascending: false })
      setOrders((o as Order[]) || [])

      setLoading(false)
    }
    load()
  }, [supabase, router])

  async function connectStripe() {
    const res = await fetch('/api/stripe/connect', { method: 'POST' })
    const data = await res.json()
    if (data.url) window.location.href = data.url
  }

  async function loadMarketPrices() {
    const cardIds = [...new Set(listings.filter(l => l.status === 'active').map(l => l.card_id))]
    const prices: Record<string, number> = {}
    for (const cardId of cardIds) {
      try {
        const res = await fetch(`/api/cards?id=${encodeURIComponent(cardId)}`)
        const data = await res.json()
        if (data.card?.price?.marketPrice) {
          prices[cardId] = data.card.price.marketPrice
        }
      } catch { /* skip */ }
    }
    setMarketPrices(prices)
  }

  async function applyBulkPrice() {
    const pct = parseFloat(bulkAdjustment) / 100
    setBulkUpdating(true)

    for (const listing of activeListings) {
      const market = marketPrices[listing.card_id]
      if (!market) continue
      const newPrice = Math.max(0.01, market * (1 + pct))
      await supabase
        .from('listings')
        .update({ price: parseFloat(newPrice.toFixed(2)) })
        .eq('id', listing.id)
    }

    // Refresh listings
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: l } = await supabase
        .from('listings')
        .select('*')
        .eq('seller_id', user.id)
        .order('created_at', { ascending: false })
      setListings((l as Listing[]) || [])
    }
    setBulkUpdating(false)
    setShowBulkPrice(false)
  }

  if (loading) {
    return (
      <div className="py-20 text-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  const activeListings = listings.filter(l => l.status === 'active')
  const pendingOrders = orders.filter(o => o.status === 'paid')
  const revenue = orders
    .filter(o => ['paid', 'shipped', 'delivered'].includes(o.status))
    .reduce((sum, o) => sum + Number(o.subtotal) - Number(o.platform_fee), 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-zinc-900">Seller Dashboard</h1>
        <Link
          href="/sell"
          className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-500 text-white font-semibold transition-colors"
        >
          + List a Card
        </Link>
      </div>

      {/* Stripe onboarding notice */}
      {profile && !profile.stripe_onboarding_complete && (
        <div className="mb-6 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
          <p className="text-yellow-300 text-sm">
            Set up Stripe to receive payments.{' '}
            <button onClick={connectStripe} className="text-yellow-200 underline cursor-pointer font-medium">
              Connect Stripe Account
            </button>
          </p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Active Listings', value: activeListings.length },
          { label: 'Pending Orders', value: pendingOrders.length },
          { label: 'Total Sales', value: profile?.total_sales || 0 },
          { label: 'Revenue', value: `$${revenue.toFixed(2)}` },
        ].map(stat => (
          <div key={stat.label} className="bg-white border border-zinc-200 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-zinc-900">{stat.value}</p>
            <p className="text-xs text-zinc-500">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-zinc-200">
        {(['listings', 'orders', 'settings'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors cursor-pointer capitalize ${
              tab === t
                ? 'text-orange-400 border-b-2 border-orange-400'
                : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'listings' && (
        <div>
          {/* Bulk pricing controls */}
          {activeListings.length > 0 && (
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-zinc-500">{activeListings.length} active listing{activeListings.length !== 1 ? 's' : ''}</p>
              <button
                onClick={() => { setShowBulkPrice(!showBulkPrice); if (!showBulkPrice) loadMarketPrices(); }}
                className="text-sm text-orange-500 hover:text-orange-600 font-medium transition-colors cursor-pointer"
              >
                {showBulkPrice ? 'Cancel' : 'Bulk Price Update'}
              </button>
            </div>
          )}

          {showBulkPrice && (
            <div className="mb-6 p-4 bg-white border border-orange-200 rounded-lg">
              <h3 className="font-medium text-zinc-900 mb-3">Bulk Price Update</h3>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-sm text-zinc-600">Set all active listings to</span>
                <input
                  type="number"
                  value={bulkAdjustment}
                  onChange={e => setBulkAdjustment(e.target.value)}
                  className="w-20 px-3 py-1.5 rounded-lg bg-zinc-100 border border-zinc-200 text-zinc-900 text-sm"
                />
                <span className="text-sm text-zinc-600">% vs. TCGPlayer market</span>
              </div>
              <p className="text-xs text-zinc-500 mb-3">
                {Object.keys(marketPrices).length === 0
                  ? 'Loading market prices...'
                  : `${Object.keys(marketPrices).length} card${Object.keys(marketPrices).length !== 1 ? 's' : ''} with market data. Negative = undercut market.`}
              </p>
              <button
                onClick={applyBulkPrice}
                disabled={bulkUpdating || Object.keys(marketPrices).length === 0}
                className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold disabled:opacity-50 transition-colors cursor-pointer"
              >
                {bulkUpdating ? 'Updating...' : 'Apply to All Active Listings'}
              </button>
            </div>
          )}

          <div className="space-y-3">
          {listings.length === 0 ? (
            <p className="text-zinc-500 text-center py-8">No listings yet. Create your first listing!</p>
          ) : (
            listings.map(listing => (
              <Link
                key={listing.id}
                href={`/sell/${listing.id}/edit`}
                className="flex items-center justify-between p-4 rounded-lg bg-white border border-zinc-200 hover:border-zinc-300 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {(listing.photo_urls?.[0] || cardImages[listing.card_id]) ? (
                    <Image
                      src={listing.photo_urls?.[0] || cardImages[listing.card_id]}
                      alt={listing.title}
                      width={48}
                      height={67}
                      className="rounded object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-[48px] h-[67px] rounded bg-zinc-100 flex-shrink-0" />
                  )}
                  <div>
                  <p className="font-medium text-zinc-900">{listing.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <ConditionBadge condition={listing.condition} gradingCompany={listing.grading_company} grade={listing.grade} />
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      listing.status === 'active' ? 'bg-green-500/10 text-green-400' :
                      listing.status === 'sold' ? 'bg-zinc-200 text-zinc-500' :
                      'bg-red-500/10 text-red-400'
                    }`}>
                      {listing.status}
                    </span>
                    <span className="text-xs text-zinc-500">{listing.quantity_available} avail</span>
                  </div>
                </div>
                </div>
                <div className="flex items-center gap-3">
                  <p className="text-lg font-bold text-zinc-900">${Number(listing.price).toFixed(2)}</p>
                  <svg className="w-4 h-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </Link>
            ))
          )}
          </div>
        </div>
      )}

      {tab === 'orders' && (
        <div className="space-y-3">
          {orders.length === 0 ? (
            <p className="text-zinc-500 text-center py-8">No orders yet.</p>
          ) : (
            orders.map(order => (
              <Link
                key={order.id}
                href={`/orders/${order.id}`}
                className="block p-4 rounded-lg bg-white border border-zinc-200 hover:border-zinc-300 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-zinc-900">
                      Order #{order.id.slice(0, 8)}
                    </p>
                    <p className="text-sm text-zinc-500">
                      {order.items?.length || 0} items &middot; {(order.buyer as { display_name: string })?.display_name || 'Unknown buyer'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-zinc-900">${Number(order.total).toFixed(2)}</p>
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      order.status === 'paid' ? 'bg-yellow-500/10 text-yellow-400' :
                      order.status === 'shipped' ? 'bg-blue-500/10 text-blue-400' :
                      order.status === 'delivered' ? 'bg-green-500/10 text-green-400' :
                      'bg-zinc-200 text-zinc-500'
                    }`}>
                      {order.status}
                    </span>
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      )}

      {tab === 'settings' && (
        <div className="bg-white border border-zinc-200 rounded-lg p-6 space-y-4">
          <div>
            <h3 className="font-medium text-zinc-900 mb-2">Stripe Payments</h3>
            {profile?.stripe_onboarding_complete ? (
              <p className="text-green-400 text-sm">Connected and ready to receive payments</p>
            ) : (
              <button onClick={connectStripe} className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-500 text-white text-sm font-medium cursor-pointer">
                {profile?.stripe_account_id ? 'Complete Stripe Setup' : 'Connect Stripe'}
              </button>
            )}
          </div>
          <div>
            <h3 className="font-medium text-zinc-900 mb-2">Platform Fee</h3>
            <p className="text-zinc-500 text-sm">9% on each sale</p>
          </div>
        </div>
      )}
    </div>
  )
}
