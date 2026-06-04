'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Profile, Listing, Order } from '@/types/database'
import { Overview } from './Overview'
import { InventoryTable } from './InventoryTable'
import { BulkCreate } from './BulkCreate'
import { OffersPanel } from './OffersPanel'
import { OrdersTable } from './OrdersTable'

export type SellerHubTab = 'overview' | 'inventory' | 'add' | 'offers' | 'orders'
const VALID_TABS: SellerHubTab[] = ['overview', 'inventory', 'add', 'offers', 'orders']

const TAB_LABELS: Record<SellerHubTab, string> = {
  overview: 'Overview',
  inventory: 'Inventory',
  add: 'Add Listings',
  offers: 'Offers',
  orders: 'Orders',
}

interface Props {
  userId: string
  profile: Profile
}

/** Seller Hub — dense, table-first workspace for power sellers. The
 *  server page (requireSeller) hands us the authed profile; everything
 *  dynamic loads client-side here so inline edits update in place. */
export function SellerHubClient({ userId, profile }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const [tab, setTab] = useState<SellerHubTab>('overview')
  const [loading, setLoading] = useState(true)

  const [listings, setListings] = useState<Listing[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [cardImages, setCardImages] = useState<Record<string, string>>({})
  const [cardNames, setCardNames] = useState<Record<string, string>>({})
  const [marketPrices, setMarketPrices] = useState<Record<string, number>>({})

  const didLoad = useRef(false)

  // Read the deep-linked tab (?tab=orders) once on mount, and keep the URL
  // in sync as the seller switches tabs — without pulling in useSearchParams
  // (which would force a Suspense boundary).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab')
    if (t && (VALID_TABS as string[]).includes(t)) setTab(t as SellerHubTab)
  }, [])

  const selectTab = useCallback((next: SellerHubTab) => {
    setTab(next)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', next)
    window.history.replaceState(null, '', url.toString())
  }, [])

  useEffect(() => {
    if (didLoad.current) return
    didLoad.current = true
    async function load() {
      try {
        const [{ data: l }, { data: o }] = await Promise.all([
          supabase
            .from('listings')
            .select('*')
            .eq('seller_id', userId)
            .order('created_at', { ascending: false }),
          supabase
            .from('orders')
            .select('*, buyer:profiles!orders_buyer_id_fkey(display_name, username), items:order_items(*)')
            .eq('seller_id', userId)
            .not('status', 'in', '("pending_payment","cancelled")')
            .order('created_at', { ascending: false }),
        ])

        const fetchedListings = (l as Listing[]) || []
        const fetchedOrders = (o as Order[]) || []
        setListings(fetchedListings)
        setOrders(fetchedOrders)
        // The Offers tab loads its own actionable bids (scoped to the
        // seller's inventory) when opened.

        // Batch card metadata for every card_id we reference (listings +
        // order items). Full endpoint (no basic=1) so we also get market
        // price for the Inventory table's market + payout columns.
        const orderCardIds = fetchedOrders.flatMap(ord => ord.items?.map(i => i.card_id) || [])
        const uniqueCardIds = [...new Set([
          ...fetchedListings.map(li => li.card_id),
          ...orderCardIds,
        ])]
        if (uniqueCardIds.length > 0) {
          try {
            const res = await fetch(`/api/cards?ids=${encodeURIComponent(uniqueCardIds.join(','))}`)
            const data = await res.json()
            const images: Record<string, string> = {}
            const names: Record<string, string> = {}
            const prices: Record<string, number> = {}
            for (const card of data.cards || []) {
              if (card.imageUrl) images[card.id] = card.imageUrl
              if (card.name) names[card.id] = card.name
              if (card.price?.marketPrice) prices[card.id] = card.price.marketPrice
            }
            setCardImages(images)
            setCardNames(names)
            setMarketPrices(prices)
          } catch { /* tiles/market columns degrade gracefully */ }
        }
      } catch (err) {
        console.error('[sellerhub] load failed', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [supabase, userId])

  const activeCount = listings.filter(l => l.status === 'active').length
  const pendingSales = orders.filter(o => ['paid', 'seller_shipped', 'received', 'authenticated'].includes(o.status)).length

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900">Seller Hub</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Your power-seller workspace — bulk tools, inline pricing, offers, and orders.
          </p>
        </div>
        <Link
          href="/mystuff"
          className="text-sm font-medium text-zinc-500 hover:text-zinc-900 transition-colors"
        >
          ← Back to My Stuff
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-zinc-200 mb-6 overflow-x-auto">
        {VALID_TABS.map(t => {
          const badge =
            t === 'inventory' ? activeCount :
            t === 'orders' ? pendingSales : 0
          return (
            <button
              key={t}
              onClick={() => selectTab(t)}
              className={`px-4 py-2.5 text-sm font-semibold border-b-2 whitespace-nowrap transition-colors ${
                tab === t
                  ? 'border-orange-500 text-orange-600'
                  : 'border-transparent text-zinc-500 hover:text-zinc-900'
              }`}
            >
              {TAB_LABELS[t]}
              {badge > 0 && (
                <span className="ml-2 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 tabular-nums">
                  {badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="py-20 text-center">
          <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : (
        <>
          {tab === 'overview' && (
            <Overview
              profile={profile}
              listings={listings}
              orders={orders}
              onNavigate={selectTab}
            />
          )}
          {tab === 'inventory' && (
            <InventoryTable
              listings={listings}
              onListingsChange={setListings}
              cardImages={cardImages}
              marketPrices={marketPrices}
              tier={profile.seller_tier}
            />
          )}
          {tab === 'add' && (
            <BulkCreate
              onCreated={created => setListings(prev => [...created, ...prev])}
            />
          )}
          {tab === 'offers' && (
            <OffersPanel
              listings={listings}
              userId={userId}
              cardImages={cardImages}
              cardNames={cardNames}
              tier={profile.seller_tier}
            />
          )}
          {tab === 'orders' && (
            <OrdersTable
              orders={orders}
              onOrdersChange={setOrders}
              hasShippingAddress={!!(profile.shipping_street1 && profile.shipping_city && profile.shipping_state && profile.shipping_zip)}
            />
          )}
        </>
      )}
    </div>
  )
}
