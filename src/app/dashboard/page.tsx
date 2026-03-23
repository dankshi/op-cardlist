'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { ConditionBadge } from '@/components/marketplace/ConditionBadge'
import type { Profile, Listing, Order } from '@/types/database'
import { US_STATES } from '@/lib/us-states'

type Tab = 'listings' | 'orders' | 'settings'

const STATUS_STYLES: Record<string, string> = {
  paid: 'bg-yellow-500/10 text-yellow-600',
  seller_shipped: 'bg-blue-500/10 text-blue-600',
  received: 'bg-purple-500/10 text-purple-600',
  authenticated: 'bg-emerald-500/10 text-emerald-600',
  shipped_to_buyer: 'bg-blue-500/10 text-blue-600',
  shipped: 'bg-blue-500/10 text-blue-600',
  delivered: 'bg-green-500/10 text-green-600',
}

const STATUS_LABELS: Record<string, string> = {
  paid: 'Action Required',
  seller_shipped: 'Shipped to Platform',
  received: 'Received by Platform',
  authenticated: 'Authenticated',
  shipped_to_buyer: 'Shipped to Buyer',
  shipped: 'Shipped',
  delivered: 'Delivered',
}

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
  const [addrStreet, setAddrStreet] = useState('')
  const [addrCity, setAddrCity] = useState('')
  const [addrState, setAddrState] = useState('')
  const [addrZip, setAddrZip] = useState('')
  const [addrPhone, setAddrPhone] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [addrSaving, setAddrSaving] = useState(false)
  const [addrMessage, setAddrMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth/sign-in'); return }
      setUserEmail(user.email || '')

      const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      if (!p?.is_seller) { router.push('/seller/apply'); return }
      setProfile(p as Profile)
      if (p.shipping_street1) setAddrStreet(p.shipping_street1)
      if (p.shipping_city) setAddrCity(p.shipping_city)
      if (p.shipping_state) setAddrState(p.shipping_state)
      if (p.shipping_zip) setAddrZip(p.shipping_zip)
      if (p.shipping_phone) setAddrPhone(p.shipping_phone)

      const { data: l } = await supabase
        .from('listings')
        .select('*')
        .eq('seller_id', user.id)
        .order('created_at', { ascending: false })
      const fetchedListings = (l as Listing[]) || []
      setListings(fetchedListings)

      const { data: o } = await supabase
        .from('orders')
        .select('*, buyer:profiles!orders_buyer_id_fkey(display_name), items:order_items(*)')
        .eq('seller_id', user.id)
        .not('status', 'in', '("pending_payment","cancelled")')
        .order('created_at', { ascending: false })
      const fetchedOrders = (o as Order[]) || []
      setOrders(fetchedOrders)

      // Fetch card images for listings + order items
      const orderCardIds = fetchedOrders.flatMap(order => order.items?.map(i => i.card_id) || [])
      const uniqueCardIds = [...new Set([...fetchedListings.map(li => li.card_id), ...orderCardIds])]
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

      setLoading(false)
    }
    load()
  }, [supabase, router])

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
  const pendingOrders = orders.filter(o => ['paid', 'seller_shipped', 'received', 'authenticated'].includes(o.status))
  const revenue = orders
    .filter(o => ['paid', 'seller_shipped', 'received', 'authenticated', 'shipped_to_buyer', 'shipped', 'delivered'].includes(o.status))
    .reduce((sum, o) => sum + Number(o.subtotal) - Number(o.platform_fee), 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-zinc-900">My Shop</h1>
        <Link
          href="/sell"
          className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-500 text-white font-semibold transition-colors"
        >
          + List a Card
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Balance', value: `$${Number(profile?.balance || 0).toFixed(2)}`, onClick: () => setTab('settings') },
          { label: 'Active Listings', value: activeListings.length, onClick: () => setTab('listings') },
          { label: 'Pending Orders', value: pendingOrders.length, onClick: () => setTab('orders') },
          { label: 'Total Sales', value: profile?.total_sales || 0 },
        ].map(stat => (
          <div
            key={stat.label}
            onClick={'onClick' in stat ? stat.onClick : undefined}
            className={`bg-white border border-zinc-200 rounded-lg p-4 text-center ${
              'onClick' in stat ? 'cursor-pointer hover:border-zinc-300 transition-colors' : ''
            }`}
          >
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
          {listings.filter(l => l.status !== 'sold').length === 0 ? (
            <p className="text-zinc-500 text-center py-8">No listings yet. Create your first listing!</p>
          ) : (
            listings.filter(l => l.status !== 'sold').map(listing => (
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
            orders.map(order => {
              const firstItem = order.items?.[0]
              return (
                <Link
                  key={order.id}
                  href={`/orders/${order.id}`}
                  className="block p-4 rounded-lg bg-white border border-zinc-200 hover:border-zinc-300 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    {(firstItem?.snapshot_photo_url || (firstItem?.card_id && cardImages[firstItem.card_id])) ? (
                      <Image
                        src={firstItem?.snapshot_photo_url || (firstItem?.card_id ? cardImages[firstItem.card_id] : '')}
                        alt={firstItem?.card_name || ''}
                        width={64}
                        height={89}
                        className="w-16 h-[89px] rounded object-cover flex-shrink-0"
                        unoptimized
                      />
                    ) : (
                      <div className="w-16 h-[89px] rounded bg-zinc-100 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-zinc-900 truncate">
                        {firstItem?.card_name || `Order #${order.id.slice(0, 8)}`}
                      </p>
                      <p className="text-sm text-zinc-500">
                        Buyer: {(order.buyer as { display_name: string })?.display_name || 'Unknown'}
                      </p>
                      <span className={`inline-block text-xs px-2 py-0.5 rounded mt-1 font-medium ${
                        STATUS_STYLES[order.status] || 'bg-zinc-200 text-zinc-500'
                      }`}>
                        {STATUS_LABELS[order.status] || order.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-bold text-lg text-zinc-900">${Number(order.total).toFixed(2)}</p>
                    </div>
                  </div>
                </Link>
              )
            })
          )}
        </div>
      )}

      {tab === 'settings' && (
        <div className="space-y-6">
          <div className="bg-white border border-zinc-200 rounded-lg p-6 space-y-4">
            <div>
              <h3 className="font-medium text-zinc-900 mb-2">Balance</h3>
              <p className="text-2xl font-bold text-zinc-900">${Number(profile?.balance || 0).toFixed(2)}</p>
              <p className="text-zinc-500 text-sm mt-1">Credits from sales (1:1 USD). Cash out coming soon.</p>
            </div>
            <div>
              <h3 className="font-medium text-zinc-900 mb-2">Platform Fee</h3>
              <p className="text-zinc-500 text-sm">9.5% on each sale</p>
            </div>
          </div>

          <div className="bg-white border border-zinc-200 rounded-lg p-6">
            <h3 className="font-medium text-zinc-900 mb-1">Shipping Address</h3>
            <p className="text-sm text-zinc-500 mb-4">Used as the return address when generating shipping labels.</p>

            <div className="space-y-3">
              <div>
                <label className="block text-sm text-zinc-700 mb-1">Street Address</label>
                <input
                  type="text"
                  value={addrStreet}
                  onChange={e => setAddrStreet(e.target.value)}
                  placeholder="123 Main St"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-100 border border-zinc-200 text-zinc-900 placeholder-zinc-400 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                />
              </div>
              <div className="grid grid-cols-6 gap-3">
                <div className="col-span-3">
                  <label className="block text-sm text-zinc-700 mb-1">City</label>
                  <input
                    type="text"
                    value={addrCity}
                    onChange={e => setAddrCity(e.target.value)}
                    placeholder="City"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-100 border border-zinc-200 text-zinc-900 placeholder-zinc-400 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm text-zinc-700 mb-1">State</label>
                  <select
                    value={addrState}
                    onChange={e => setAddrState(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-zinc-100 border border-zinc-200 text-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  >
                    <option value="">Select</option>
                    {US_STATES.map(s => (
                      <option key={s.value} value={s.value}>{s.value}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-1">
                  <label className="block text-sm text-zinc-700 mb-1">ZIP</label>
                  <input
                    type="text"
                    value={addrZip}
                    onChange={e => setAddrZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
                    placeholder="00000"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-100 border border-zinc-200 text-zinc-900 placeholder-zinc-400 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-zinc-700 mb-1">Phone Number</label>
                <input
                  type="tel"
                  value={addrPhone}
                  onChange={e => setAddrPhone(e.target.value)}
                  placeholder="(555) 555-5555"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-100 border border-zinc-200 text-zinc-900 placeholder-zinc-400 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                />
              </div>
            </div>

            {addrMessage && (
              <p className={`text-sm mt-3 ${addrMessage.type === 'success' ? 'text-green-600' : 'text-red-500'}`}>
                {addrMessage.text}
              </p>
            )}

            <button
              onClick={async () => {
                if (!addrStreet || !addrCity || !addrState || !addrZip || !addrPhone) {
                  setAddrMessage({ type: 'error', text: 'Please fill in all fields.' })
                  return
                }
                setAddrSaving(true)
                setAddrMessage(null)
                const { error } = await supabase
                  .from('profiles')
                  .update({
                    shipping_street1: addrStreet,
                    shipping_city: addrCity,
                    shipping_state: addrState,
                    shipping_zip: addrZip,
                    shipping_email: userEmail,
                    shipping_phone: addrPhone,
                  })
                  .eq('id', profile!.id)
                if (error) {
                  setAddrMessage({ type: 'error', text: 'Failed to save address.' })
                } else {
                  setAddrMessage({ type: 'success', text: 'Address saved!' })
                  setProfile({ ...profile!, shipping_street1: addrStreet, shipping_city: addrCity, shipping_state: addrState, shipping_zip: addrZip, shipping_email: userEmail, shipping_phone: addrPhone })
                }
                setAddrSaving(false)
              }}
              disabled={addrSaving}
              className="mt-4 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm transition-colors cursor-pointer disabled:opacity-50"
            >
              {addrSaving ? 'Saving...' : 'Save Address'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
