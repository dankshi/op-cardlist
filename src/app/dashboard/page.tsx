'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
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
      setListings((l as Listing[]) || [])

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

  if (loading) {
    return (
      <div className="py-20 text-center">
        <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto" />
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
        <h1 className="text-3xl font-bold text-zinc-100 light:text-gray-900">Seller Dashboard</h1>
        <Link
          href="/sell"
          className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold transition-colors"
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
          <div key={stat.label} className="bg-zinc-900 light:bg-white border border-zinc-800 light:border-gray-200 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-zinc-100 light:text-gray-900">{stat.value}</p>
            <p className="text-xs text-zinc-400 light:text-gray-500">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-zinc-800 light:border-gray-200">
        {(['listings', 'orders', 'settings'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors cursor-pointer capitalize ${
              tab === t
                ? 'text-sky-400 border-b-2 border-sky-400'
                : 'text-zinc-400 light:text-gray-500 hover:text-zinc-200 light:hover:text-gray-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'listings' && (
        <div className="space-y-3">
          {listings.length === 0 ? (
            <p className="text-zinc-500 light:text-gray-400 text-center py-8">No listings yet. Create your first listing!</p>
          ) : (
            listings.map(listing => (
              <div key={listing.id} className="flex items-center justify-between p-4 rounded-lg bg-zinc-900 light:bg-white border border-zinc-800 light:border-gray-200">
                <div>
                  <p className="font-medium text-zinc-100 light:text-gray-900">{listing.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <ConditionBadge condition={listing.condition} />
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      listing.status === 'active' ? 'bg-green-500/10 text-green-400' :
                      listing.status === 'sold' ? 'bg-zinc-700 light:bg-gray-200 text-zinc-400 light:text-gray-500' :
                      'bg-red-500/10 text-red-400'
                    }`}>
                      {listing.status}
                    </span>
                    <span className="text-xs text-zinc-500 light:text-gray-400">{listing.quantity_available} avail</span>
                  </div>
                </div>
                <p className="text-lg font-bold text-zinc-100 light:text-gray-900">${Number(listing.price).toFixed(2)}</p>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'orders' && (
        <div className="space-y-3">
          {orders.length === 0 ? (
            <p className="text-zinc-500 light:text-gray-400 text-center py-8">No orders yet.</p>
          ) : (
            orders.map(order => (
              <Link
                key={order.id}
                href={`/orders/${order.id}`}
                className="block p-4 rounded-lg bg-zinc-900 light:bg-white border border-zinc-800 light:border-gray-200 hover:border-zinc-700 light:hover:border-gray-300 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-zinc-100 light:text-gray-900">
                      Order #{order.id.slice(0, 8)}
                    </p>
                    <p className="text-sm text-zinc-400 light:text-gray-500">
                      {order.items?.length || 0} items &middot; {(order.buyer as { display_name: string })?.display_name || 'Unknown buyer'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-zinc-100 light:text-gray-900">${Number(order.total).toFixed(2)}</p>
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      order.status === 'paid' ? 'bg-yellow-500/10 text-yellow-400' :
                      order.status === 'shipped' ? 'bg-blue-500/10 text-blue-400' :
                      order.status === 'delivered' ? 'bg-green-500/10 text-green-400' :
                      'bg-zinc-700 light:bg-gray-200 text-zinc-400 light:text-gray-500'
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
        <div className="bg-zinc-900 light:bg-white border border-zinc-800 light:border-gray-200 rounded-lg p-6 space-y-4">
          <div>
            <h3 className="font-medium text-zinc-100 light:text-gray-900 mb-2">Stripe Payments</h3>
            {profile?.stripe_onboarding_complete ? (
              <p className="text-green-400 text-sm">Connected and ready to receive payments</p>
            ) : (
              <button onClick={connectStripe} className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium cursor-pointer">
                {profile?.stripe_account_id ? 'Complete Stripe Setup' : 'Connect Stripe'}
              </button>
            )}
          </div>
          <div>
            <h3 className="font-medium text-zinc-100 light:text-gray-900 mb-2">Platform Fee</h3>
            <p className="text-zinc-400 light:text-gray-500 text-sm">9% on each sale</p>
          </div>
        </div>
      )}
    </div>
  )
}
