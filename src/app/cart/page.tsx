'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { ConditionBadge } from '@/components/marketplace/ConditionBadge'
import type { CartItem } from '@/types/database'

interface CartItemWithImage extends CartItem {
  card_image_url?: string | null
}

export default function CartPage() {
  const [items, setItems] = useState<CartItemWithImage[]>([])
  const [loading, setLoading] = useState(true)
  const [checkingOut, setCheckingOut] = useState(false)
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
      setItems(data.items)
    }
    setLoading(false)
  }

  async function removeItem(itemId: string) {
    await fetch(`/api/cart?id=${itemId}`, { method: 'DELETE' })
    fetchCart()
  }

  // Group items by seller for checkout (Stripe requires separate sessions per seller)
  function getSellerGroups() {
    const map = new Map<string, { sellerId: string; stripeReady: boolean; subtotal: number }>()
    for (const item of items) {
      const seller = item.listing?.seller
      if (!seller) continue
      if (!map.has(seller.id)) {
        map.set(seller.id, {
          sellerId: seller.id,
          stripeReady: !!seller.stripe_account_id,
          subtotal: 0,
        })
      }
      map.get(seller.id)!.subtotal += item.quantity * Number(item.listing!.price)
    }
    return Array.from(map.values())
  }

  async function handleCheckout(sellerId: string) {
    setCheckingOut(true)
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
      setCheckingOut(false)
    }
  }

  if (loading) {
    return (
      <div className="py-20 text-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  const grandTotal = items.reduce((sum, item) => sum + item.quantity * Number(item.listing?.price || 0), 0)

  if (items.length === 0) {
    return (
      <div className="text-center py-24">
        <svg className="w-20 h-20 text-zinc-300 mx-auto mb-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
        </svg>
        <h1 className="text-2xl font-bold text-zinc-900 mb-2">Your cart is empty</h1>
        <p className="text-zinc-500 mb-8">Browse cards and add listings to your cart.</p>
        <Link href="/" className="inline-block px-8 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold transition-colors">
          Browse Cards
        </Link>
      </div>
    )
  }

  const sellerGroups = getSellerGroups()

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-zinc-900">
          Shopping Cart
          <span className="text-zinc-400 text-lg font-normal ml-3">
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </span>
        </h1>
        <Link href="/" className="text-sm text-zinc-500 hover:text-orange-500 transition-colors flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Continue Shopping
        </Link>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Cart items — left column */}
        <div className="lg:col-span-2">
          <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden divide-y divide-zinc-100">
            {items.map((item) => {
              const cardHref = item.listing?.card_id
                ? `/card/${item.listing.card_id.toLowerCase()}`
                : null
              const unitPrice = Number(item.listing?.price || 0)
              const lineTotal = item.quantity * unitPrice

              return (
                <div key={item.id} className="px-6 py-5 flex items-start gap-4">
                  {/* Card image */}
                  <div className="flex-shrink-0">
                    {cardHref ? (
                      <Link href={cardHref}>
                        {item.card_image_url ? (
                          <Image
                            src={item.card_image_url}
                            alt={item.listing?.title || 'Card'}
                            width={80}
                            height={112}
                            className="rounded-lg object-cover shadow-sm hover:shadow-md transition-shadow"
                          />
                        ) : (
                          <div className="w-20 h-28 rounded-lg bg-zinc-100 flex items-center justify-center">
                            <svg className="w-6 h-6 text-zinc-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                            </svg>
                          </div>
                        )}
                      </Link>
                    ) : item.card_image_url ? (
                      <Image
                        src={item.card_image_url}
                        alt={item.listing?.title || 'Card'}
                        width={80}
                        height={112}
                        className="rounded-lg object-cover shadow-sm"
                      />
                    ) : (
                      <div className="w-20 h-28 rounded-lg bg-zinc-100 flex items-center justify-center">
                        <svg className="w-6 h-6 text-zinc-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                        </svg>
                      </div>
                    )}
                  </div>

                  {/* Item details */}
                  <div className="flex-1 min-w-0">
                    {cardHref ? (
                      <Link href={cardHref} className="font-medium text-zinc-900 hover:text-orange-500 transition-colors line-clamp-2">
                        {item.listing?.title || 'Unknown'}
                      </Link>
                    ) : (
                      <p className="font-medium text-zinc-900 line-clamp-2">
                        {item.listing?.title || 'Unknown'}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      {item.listing && <ConditionBadge condition={item.listing.condition} gradingCompany={item.listing.grading_company} grade={item.listing.grade} />}
                    </div>
                    <p className="text-sm text-zinc-500 mt-2">
                      ${unitPrice.toFixed(2)} each
                      {item.quantity > 1 && <span> &times; {item.quantity}</span>}
                    </p>
                    <button
                      onClick={() => removeItem(item.id)}
                      className="text-xs text-zinc-400 hover:text-red-500 transition-colors mt-3 flex items-center gap-1 cursor-pointer"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                      Remove
                    </button>
                  </div>

                  {/* Price */}
                  <div className="text-right flex-shrink-0">
                    <span className="font-semibold text-zinc-900 text-lg">
                      ${lineTotal.toFixed(2)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Order summary — right column */}
        <div className="lg:col-span-1">
          <div className="bg-white border border-zinc-200 rounded-2xl p-6 lg:sticky lg:top-24 space-y-6">
            <h2 className="text-lg font-bold text-zinc-900">Order Summary</h2>

            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Subtotal ({items.length} {items.length === 1 ? 'item' : 'items'})</span>
                <span className="text-zinc-900 font-medium">${grandTotal.toFixed(2)}</span>
              </div>
            </div>

            <div className="border-t border-zinc-200 pt-4">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-zinc-900">Total</span>
                <span className="text-2xl font-bold text-zinc-900">${grandTotal.toFixed(2)}</span>
              </div>
              <p className="text-xs text-zinc-400 mt-1">Shipping calculated at checkout</p>
            </div>

            {/* Checkout — one button if single seller, multiple if needed */}
            <div className="space-y-3">
              {sellerGroups.length === 1 ? (
                <button
                  onClick={() => handleCheckout(sellerGroups[0].sellerId)}
                  disabled={checkingOut || !sellerGroups[0].stripeReady}
                  className="w-full px-4 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-300 disabled:cursor-not-allowed text-white font-semibold transition-colors cursor-pointer"
                >
                  {checkingOut ? 'Processing...' : !sellerGroups[0].stripeReady ? 'Seller not ready' : `Checkout — $${grandTotal.toFixed(2)}`}
                </button>
              ) : (
                sellerGroups.map((group, i) => (
                  <button
                    key={group.sellerId}
                    onClick={() => handleCheckout(group.sellerId)}
                    disabled={checkingOut || !group.stripeReady}
                    className="w-full px-4 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-300 disabled:cursor-not-allowed text-white font-semibold transition-colors cursor-pointer text-sm"
                  >
                    {checkingOut
                      ? 'Processing...'
                      : !group.stripeReady
                        ? 'Seller not ready'
                        : `Checkout ${i + 1} of ${sellerGroups.length} — $${group.subtotal.toFixed(2)}`}
                  </button>
                ))
              )}
            </div>

            {sellerGroups.length > 1 && (
              <p className="text-xs text-zinc-400 text-center">
                Items require separate checkouts
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
