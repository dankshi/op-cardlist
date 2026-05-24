'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { StorefrontGrid } from '@/components/dashboard/StorefrontGrid'
import { MyOffersGrid } from '@/components/dashboard/MyOffersGrid'
import type { Profile, Listing, Order, Bid } from '@/types/database'
import { US_STATES } from '@/lib/us-states'

type Tab = 'selling' | 'collection' | 'offers' | 'orders' | 'settings'

const STATUS_STYLES: Record<string, string> = {
  under_review: 'bg-amber-500/10 text-amber-700',
  paid: 'bg-yellow-500/10 text-yellow-600',
  seller_shipped: 'bg-blue-500/10 text-blue-600',
  received: 'bg-purple-500/10 text-purple-600',
  authenticated: 'bg-emerald-500/10 text-emerald-600',
  shipped_to_buyer: 'bg-blue-500/10 text-blue-600',
  shipped: 'bg-blue-500/10 text-blue-600',
  delivered: 'bg-green-500/10 text-green-600',
}

const STATUS_LABELS: Record<string, string> = {
  under_review: 'Under Review — Don’t Ship Yet',
  paid: 'Action Required',
  seller_shipped: 'Shipped to Platform',
  received: 'Received by Platform',
  authenticated: 'Authenticated',
  shipped_to_buyer: 'Shipped to Buyer',
  shipped: 'Shipped',
  delivered: 'Delivered',
}

export default function MyStuffPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [listings, setListings] = useState<Listing[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  // User's own active offers (bids they've placed on other people's cards).
  // Loaded alongside listings + orders so the tab badge is accurate even
  // before the tab is opened.
  const [offers, setOffers] = useState<Bid[]>([])
  const [offerCardNames, setOfferCardNames] = useState<Record<string, string>>({})
  const [tab, setTab] = useState<Tab>('selling')
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
      try {
        const { data: { user }, error: userError } = await supabase.auth.getUser()
        if (userError) console.error('[mystuff] getUser failed', userError)
        if (!user) { router.push('/auth/sign-in'); return }
        setUserEmail(user.email || '')

        const { data: p, error: profileError } = await supabase.from('profiles').select('*').eq('id', user.id).single()
        if (profileError) console.error('[mystuff] profile fetch failed', profileError)
        if (!p?.is_seller) { router.push('/seller/apply'); return }
        setProfile(p as Profile)
        if (p.shipping_street1) setAddrStreet(p.shipping_street1)
        if (p.shipping_city) setAddrCity(p.shipping_city)
        if (p.shipping_state) setAddrState(p.shipping_state)
        if (p.shipping_zip) setAddrZip(p.shipping_zip)
        if (p.shipping_phone) setAddrPhone(p.shipping_phone)

        const { data: l, error: listingsError } = await supabase
          .from('listings')
          .select('*')
          .eq('seller_id', user.id)
          .order('created_at', { ascending: false })
        if (listingsError) console.error('[mystuff] listings fetch failed', listingsError)
        const fetchedListings = (l as Listing[]) || []
        setListings(fetchedListings)

        const { data: o, error: ordersError } = await supabase
          .from('orders')
          .select('*, buyer:profiles!orders_buyer_id_fkey(display_name), items:order_items(*)')
          .eq('seller_id', user.id)
          .not('status', 'in', '("pending_payment","cancelled")')
          .order('created_at', { ascending: false })
        if (ordersError) console.error('[mystuff] orders fetch failed', ordersError)
        const fetchedOrders = (o as Order[]) || []
        setOrders(fetchedOrders)

        // User's own active offers — bids they've placed on cards. Fetched
        // alongside listings so the offers tab badge is accurate without
        // waiting for the tab to be opened.
        const offerRes = await fetch(`/api/bids?user_id=${encodeURIComponent(user.id)}&limit=50`)
        const offerData = await offerRes.json()
        const fetchedOffers = (offerData.bids as Bid[]) || []
        setOffers(fetchedOffers)

        // Fetch card images for listings + order items + offers in a single
        // batch. Offers also need a display name for the tile, so collect
        // names too. /api/cards already returns both.
        const orderCardIds = fetchedOrders.flatMap(order => order.items?.map(i => i.card_id) || [])
        const offerCardIds = fetchedOffers.map(o => o.card_id)
        const uniqueCardIds = [...new Set([
          ...fetchedListings.map(li => li.card_id),
          ...orderCardIds,
          ...offerCardIds,
        ])]
        const images: Record<string, string> = {}
        const names: Record<string, string> = {}
        await Promise.all(
          uniqueCardIds.map(async (cardId) => {
            try {
              const res = await fetch(`/api/cards?id=${encodeURIComponent(cardId)}`)
              const data = await res.json()
              if (data.card?.imageUrl) {
                images[cardId] = data.card.imageUrl
              }
              if (data.card?.name) {
                names[cardId] = data.card.name
              }
            } catch { /* skip */ }
          })
        )
        setCardImages(images)
        setOfferCardNames(names)
      } catch (err) {
        console.error('[mystuff] init threw', err)
      } finally {
        setLoading(false)
      }
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

    for (const listing of sellingListings) {
      const market = marketPrices[listing.card_id]
      if (!market) continue
      const newPrice = Math.max(0.01, market * (1 + pct))
      await supabase
        .from('listings')
        .update({ price: parseFloat(newPrice.toFixed(2)) })
        .eq('id', listing.id)
    }

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

  const sellingListings = listings.filter(l => l.status === 'active')
  const collectionListings = listings.filter(l => l.status === 'delisted')
  const pendingOrders = orders.filter(o => ['paid', 'seller_shipped', 'received', 'authenticated'].includes(o.status))

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900">My Stuff</h1>
          <p className="text-sm text-zinc-500 mt-1">Your selling, your collection, all in one place.</p>
        </div>
        <Link
          href="/sell"
          className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-500 text-white font-semibold transition-colors"
        >
          + Add a Card
        </Link>
      </div>

      {/* Stats — five tiles now that "Offers" is a thing. Five fits two
          rows on mobile (2x2 + 1 wide) and a single row on md+. */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        {[
          { label: 'Balance', value: `$${Number(profile?.balance || 0).toFixed(2)}`, onClick: () => setTab('settings') },
          { label: 'Selling', value: sellingListings.length, onClick: () => setTab('selling') },
          { label: 'Collection', value: collectionListings.length, onClick: () => setTab('collection') },
          { label: 'My Offers', value: offers.length, onClick: () => setTab('offers') },
          { label: 'Pending Orders', value: pendingOrders.length, onClick: () => setTab('orders') },
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
      <div className="flex gap-1 mb-6 border-b border-zinc-200 overflow-x-auto scrollbar-hide">
        {([
          { v: 'selling',    label: 'Selling',    count: sellingListings.length },
          { v: 'collection', label: 'Collection', count: collectionListings.length },
          { v: 'offers',     label: 'My Offers',  count: offers.length },
          { v: 'orders',     label: 'Orders',     count: pendingOrders.length || null },
          { v: 'settings',   label: 'Settings',   count: null },
        ] as { v: Tab; label: string; count: number | null }[]).map(t => (
          <button
            key={t.v}
            onClick={() => setTab(t.v)}
            className={`px-4 py-2 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap inline-flex items-center gap-2 ${
              tab === t.v
                ? 'text-zinc-900 border-b-2 border-zinc-900'
                : 'text-zinc-500 hover:text-zinc-700 border-b-2 border-transparent'
            }`}
          >
            {t.label}
            {t.count !== null && t.count > 0 && (
              <span className={`inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[11px] font-semibold ${
                tab === t.v ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600'
              }`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Selling tab */}
      {tab === 'selling' && (
        <div>
          {sellingListings.length > 0 && (
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-zinc-500">
                {sellingListings.length} active listing{sellingListings.length !== 1 ? 's' : ''}
              </p>
              <button
                onClick={() => { setShowBulkPrice(!showBulkPrice); if (!showBulkPrice) loadMarketPrices(); }}
                className="text-sm text-orange-500 hover:text-orange-600 font-medium transition-colors cursor-pointer"
              >
                {showBulkPrice ? 'Cancel' : 'Bulk price update'}
              </button>
            </div>
          )}

          {showBulkPrice && (
            <div className="mb-6 p-4 bg-white border border-orange-200 rounded-lg">
              <h3 className="font-medium text-zinc-900 mb-3">Bulk price update</h3>
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
                {bulkUpdating ? 'Updating...' : 'Apply to all active listings'}
              </button>
            </div>
          )}

          <StorefrontGrid
            listings={listings}
            kind="selling"
            cardImages={cardImages}
            onListingsChange={setListings}
          />
        </div>
      )}

      {/* Collection tab */}
      {tab === 'collection' && (
        <div>
          <div className="mb-4 rounded-lg bg-zinc-50 border border-zinc-200 p-4 flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-zinc-100 text-zinc-700 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25A2.25 2.25 0 0113.5 8.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
              </svg>
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-zinc-900">Cards you own but aren&apos;t selling</h3>
              <p className="text-sm text-zinc-500 mt-0.5">
                Park inventory here when you&apos;re not ready to list. Tap <span className="font-medium text-emerald-700">List</span> on any card to push it back to the marketplace in one click.
              </p>
            </div>
          </div>

          <StorefrontGrid
            listings={listings}
            kind="collection"
            cardImages={cardImages}
            onListingsChange={setListings}
          />
        </div>
      )}

      {/* My Offers tab — bids the user has placed on other people's
          cards. Distinct from the seller-side Selling/Collection tabs:
          this is the buyer side of the marketplace. */}
      {tab === 'offers' && (
        <div>
          <div className="mb-4 rounded-lg bg-zinc-50 border border-zinc-200 p-4 flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 010 1.954l-7.108 4.061A1.125 1.125 0 013 16.811V8.69zM12.75 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 010 1.954l-7.108 4.061a1.125 1.125 0 01-1.683-.977V8.69z" />
              </svg>
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-zinc-900">Open offers you&apos;ve made</h3>
              <p className="text-sm text-zinc-500 mt-0.5">
                When a seller accepts your offer, the listing moves to your{' '}
                <button onClick={() => setTab('orders')} className="text-emerald-700 underline-offset-2 hover:underline cursor-pointer">Orders</button>{' '}
                tab. Cancel any time before then.
              </p>
            </div>
          </div>

          <MyOffersGrid
            offers={offers}
            cardImages={cardImages}
            cardNames={offerCardNames}
            onOffersChange={setOffers}
          />
        </div>
      )}

      {/* Orders tab */}
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

      {/* Settings tab */}
      {tab === 'settings' && (
        <div className="space-y-6">
          <div className="bg-white border border-zinc-200 rounded-lg p-6 space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-medium text-zinc-900">Balance</h3>
                <Link href="/wallet" className="text-sm text-orange-500 hover:text-orange-600 font-medium">
                  View wallet &rarr;
                </Link>
              </div>
              <p className="text-2xl font-bold text-zinc-900">${Number(profile?.balance || 0).toFixed(2)}</p>
              <p className="text-zinc-500 text-sm mt-1">Credits from sales (1:1 USD).</p>
            </div>
            <div>
              <h3 className="font-medium text-zinc-900 mb-2">Platform fee</h3>
              <p className="text-zinc-500 text-sm">9.5% on each sale</p>
            </div>
          </div>

          <div className="bg-white border border-zinc-200 rounded-lg p-6">
            <h3 className="font-medium text-zinc-900 mb-1">Shipping address</h3>
            <p className="text-sm text-zinc-500 mb-4">Used as the return address when generating shipping labels.</p>

            <div className="space-y-3">
              <div>
                <label className="block text-sm text-zinc-700 mb-1">Street address</label>
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
                <label className="block text-sm text-zinc-700 mb-1">Phone number</label>
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
              {addrSaving ? 'Saving...' : 'Save address'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
