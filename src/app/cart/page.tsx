'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { ConditionBadge } from '@/components/marketplace/ConditionBadge'
import type { CartItem } from '@/types/database'

interface SellerGroup {
  sellerId: string
  sellerName: string
  sellerUsername: string | null
  stripeReady: boolean
  items: CartItem[]
  subtotal: number
}

export default function CartPage() {
  const [groups, setGroups] = useState<SellerGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [checkingOut, setCheckingOut] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    fetchCart()
  }, [])

  async function fetchCart() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/auth/sign-in')
      return
    }

    const res = await fetch('/api/cart')
    const data = await res.json()

    if (data.items) {
      // Group by seller
      const sellerMap = new Map<string, SellerGroup>()
      for (const item of data.items) {
        const seller = item.listing?.seller
        if (!seller) continue

        if (!sellerMap.has(seller.id)) {
          sellerMap.set(seller.id, {
            sellerId: seller.id,
            sellerName: seller.display_name || 'Unknown',
            sellerUsername: seller.username,
            stripeReady: !!seller.stripe_account_id,
            items: [],
            subtotal: 0,
          })
        }
        const group = sellerMap.get(seller.id)!
        group.items.push(item)
        group.subtotal += item.quantity * Number(item.listing.price)
      }
      setGroups(Array.from(sellerMap.values()))
    }
    setLoading(false)
  }

  async function removeItem(itemId: string) {
    await fetch(`/api/cart?id=${itemId}`, { method: 'DELETE' })
    fetchCart()
  }

  async function handleCheckout(sellerId: string) {
    setCheckingOut(sellerId)
    const res = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seller_id: sellerId }),
    })
    const data = await res.json()

    if (data.url) {
      window.location.href = data.url
    } else {
      alert(data.error || 'Checkout failed')
      setCheckingOut(null)
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto py-20 text-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div className="max-w-3xl mx-auto text-center py-20">
        <svg className="w-16 h-16 text-zinc-600 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
        </svg>
        <h1 className="text-2xl font-bold text-zinc-900 mb-2">Your cart is empty</h1>
        <p className="text-zinc-500 mb-6">Browse cards and add listings to your cart.</p>
        <Link href="/" className="px-6 py-3 rounded-lg bg-orange-500 hover:bg-orange-500 text-white font-semibold transition-colors">
          Browse Cards
        </Link>
      </div>
    )
  }

  const grandTotal = groups.reduce((sum, g) => sum + g.subtotal, 0)

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold text-zinc-900 mb-8">
        Shopping Cart <span className="text-zinc-500 text-lg font-normal">({groups.reduce((s, g) => s + g.items.length, 0)} items)</span>
      </h1>

      <div className="space-y-6">
        {groups.map((group) => (
          <div key={group.sellerId} className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
            {/* Seller header */}
            <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between">
              <div>
                <Link
                  href={group.sellerUsername ? `/seller/${group.sellerUsername}` : '#'}
                  className="font-medium text-zinc-900 hover:text-orange-400 transition-colors"
                >
                  {group.sellerName}
                </Link>
              </div>
              <span className="text-sm text-zinc-500">Subtotal: ${group.subtotal.toFixed(2)}</span>
            </div>

            {/* Items */}
            <div className="divide-y divide-zinc-200">
              {group.items.map((item) => (
                <div key={item.id} className="px-6 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-900 truncate">
                        {item.listing?.title || 'Unknown'}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        {item.listing && <ConditionBadge condition={item.listing.condition} />}
                        <span className="text-xs text-zinc-500">Qty: {item.quantity}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-medium text-zinc-900">
                      ${(item.quantity * Number(item.listing?.price || 0)).toFixed(2)}
                    </span>
                    <button
                      onClick={() => removeItem(item.id)}
                      className="text-zinc-500 hover:text-red-500 transition-colors cursor-pointer"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Checkout button */}
            <div className="px-6 py-4 border-t border-zinc-200 bg-zinc-50">
              <button
                onClick={() => handleCheckout(group.sellerId)}
                disabled={checkingOut === group.sellerId || !group.stripeReady}
                className="w-full px-4 py-3 rounded-lg bg-orange-500 hover:bg-orange-500 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-semibold transition-colors cursor-pointer"
              >
                {checkingOut === group.sellerId ? 'Processing...' : !group.stripeReady ? 'Seller not ready for payments' : `Checkout — $${group.subtotal.toFixed(2)}`}
              </button>
            </div>
          </div>
        ))}
      </div>

      {groups.length > 1 && (
        <div className="mt-6 text-right text-lg font-bold text-zinc-900">
          Grand Total: ${grandTotal.toFixed(2)}
        </div>
      )}
    </div>
  )
}
