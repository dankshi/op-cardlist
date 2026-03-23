'use client'

import { useState, useEffect, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { createClient } from '@/lib/supabase/client'
import { getStripeClient } from '@/lib/stripe-client'
import { US_STATES } from '@/lib/us-states'

interface ListingInfo {
  title: string
  price: number
  photo_url: string | null
  condition: string
  grading_company: string | null
  grade: string | null
  quantity: number
}

interface PaymentIntentData {
  clientSecret: string
  orderId: string
  listing: ListingInfo
  subtotal: number
  total: number
}

const stripePromise = getStripeClient()

export default function CheckoutForm({ listingId }: { listingId: string }) {
  const router = useRouter()
  const supabase = createClient()
  const [data, setData] = useState<PaymentIntentData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push(`/auth/sign-in?next=${encodeURIComponent(`/checkout?listing_id=${listingId}`)}`)
        return
      }

      const res = await fetch('/api/stripe/payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_id: listingId, quantity: 1 }),
      })
      const json = await res.json()

      if (!res.ok) {
        setError(json.error || 'Failed to initialize checkout')
        setLoading(false)
        return
      }

      setData(json)
      setLoading(false)
    }

    init()
  }, [listingId, router, supabase])

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="space-y-6">
            <div className="h-8 w-32 bg-zinc-200 rounded animate-pulse" />
            <div className="h-64 bg-zinc-100 rounded-xl animate-pulse" />
          </div>
          <div className="space-y-6">
            <div className="h-72 bg-zinc-100 rounded-xl animate-pulse" />
            <div className="h-48 bg-zinc-100 rounded-xl animate-pulse" />
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-lg mx-auto text-center py-20">
        <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-zinc-900 mb-2">Checkout Error</h1>
        <p className="text-zinc-500 mb-6">{error}</p>
        <button
          onClick={() => router.back()}
          className="px-6 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold transition-colors cursor-pointer"
        >
          Go Back
        </button>
      </div>
    )
  }

  if (!data) return null

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret: data.clientSecret,
        appearance: {
          theme: 'stripe',
          variables: {
            colorPrimary: '#f97316',
            colorBackground: '#fafafa',
            colorText: '#18181b',
            colorDanger: '#ef4444',
            fontFamily: 'Inter, system-ui, sans-serif',
            borderRadius: '8px',
          },
        },
      }}
    >
      <CheckoutFormInner
        orderId={data.orderId}
        listing={data.listing}
        subtotal={data.subtotal}
        total={data.total}
      />
    </Elements>
  )
}

function CheckoutFormInner({
  orderId,
  listing,
  subtotal,
  total,
}: {
  orderId: string
  listing: ListingInfo
  subtotal: number
  total: number
}) {
  const stripe = useStripe()
  const elements = useElements()
  const router = useRouter()

  const [processing, setProcessing] = useState(false)
  const [paymentError, setPaymentError] = useState<string | null>(null)

  const [shipping, setShipping] = useState({
    name: '',
    line1: '',
    line2: '',
    city: '',
    state: '',
    zip: '',
  })

  function updateShipping(field: string, value: string) {
    setShipping(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()

    if (!stripe || !elements) return

    setProcessing(true)
    setPaymentError(null)

    const shippingRes = await fetch(`/api/orders/${orderId}/shipping`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: shipping.name,
        line1: shipping.line1,
        line2: shipping.line2 || undefined,
        city: shipping.city,
        state: shipping.state,
        zip: shipping.zip,
        country: 'US',
      }),
    })

    if (!shippingRes.ok) {
      const shippingData = await shippingRes.json()
      setPaymentError(shippingData.error || 'Failed to save shipping address.')
      setProcessing(false)
      return
    }

    const origin = window.location.origin
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${origin}/checkout/success?order_id=${orderId}`,
      },
    })

    if (error) {
      setPaymentError(error.message || 'Payment failed. Please try again.')
      setProcessing(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-5xl mx-auto">
      {/* Left — Order Summary */}
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-zinc-900">Checkout</h1>

        <div className="p-6 rounded-xl bg-white border border-zinc-200">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-4">Order Summary</h2>

          <div className="flex gap-4">
            {listing.photo_url && (
              <Image
                src={listing.photo_url}
                alt={listing.title}
                width={96}
                height={134}
                className="w-24 h-auto rounded-lg object-cover"
                unoptimized
              />
            )}
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-zinc-900 truncate">{listing.title}</h3>
              <p className="text-sm text-zinc-500 mt-1">
                {listing.condition}
                {listing.grading_company && listing.grade && ` — ${listing.grading_company} ${listing.grade}`}
              </p>
              <p className="text-sm text-zinc-500">Qty: {listing.quantity}</p>
              <p className="text-lg font-bold text-zinc-900 mt-2">${listing.price.toFixed(2)}</p>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-zinc-100 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500">Subtotal</span>
              <span className="text-zinc-900">${subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500">Shipping</span>
              <span className="text-zinc-900">Free</span>
            </div>
            <div className="flex justify-between text-base font-bold pt-2 border-t border-zinc-100">
              <span className="text-zinc-900">Total</span>
              <span className="text-orange-500">${total.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="p-4 rounded-lg bg-zinc-50 border border-zinc-200">
          <p className="text-xs text-zinc-500">
            Your card will be shipped to our authentication center first. Once verified, we&rsquo;ll ship it to your address.
          </p>
        </div>
      </div>

      {/* Right — Shipping + Payment */}
      <div className="space-y-6">
        {/* Shipping Address */}
        <div className="p-6 rounded-xl bg-white border border-zinc-200">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-4">Shipping Address</h2>
          <div className="space-y-3">
            <input
              name="name"
              required
              placeholder="Full name"
              value={shipping.name}
              onChange={e => updateShipping('name', e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-zinc-50 border border-zinc-200 text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-colors"
            />
            <input
              name="line1"
              required
              placeholder="Address line 1"
              value={shipping.line1}
              onChange={e => updateShipping('line1', e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-zinc-50 border border-zinc-200 text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-colors"
            />
            <input
              name="line2"
              placeholder="Apt, suite, etc. (optional)"
              value={shipping.line2}
              onChange={e => updateShipping('line2', e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-zinc-50 border border-zinc-200 text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-colors"
            />
            <div className="grid grid-cols-3 gap-3">
              <input
                name="city"
                required
                placeholder="City"
                value={shipping.city}
                onChange={e => updateShipping('city', e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-zinc-50 border border-zinc-200 text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-colors"
              />
              <select
                name="state"
                required
                value={shipping.state}
                onChange={e => updateShipping('state', e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-zinc-50 border border-zinc-200 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-colors"
              >
                <option value="">State</option>
                {US_STATES.map(s => (
                  <option key={s.value} value={s.value}>{s.value}</option>
                ))}
              </select>
              <input
                name="zip"
                required
                placeholder="ZIP"
                pattern="[0-9]{5}"
                maxLength={5}
                value={shipping.zip}
                onChange={e => updateShipping('zip', e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-zinc-50 border border-zinc-200 text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-colors"
              />
            </div>
            <p className="text-xs text-zinc-400">US shipping only</p>
          </div>
        </div>

        {/* Payment */}
        <div className="p-6 rounded-xl bg-white border border-zinc-200">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-4">Payment</h2>
          <PaymentElement />
        </div>

        {paymentError && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
            {paymentError}
          </div>
        )}

        <button
          type="submit"
          disabled={!stripe || processing}
          className="w-full px-6 py-4 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 disabled:cursor-not-allowed text-white font-bold text-lg transition-colors cursor-pointer"
        >
          {processing ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Processing...
            </span>
          ) : (
            `Pay $${total.toFixed(2)}`
          )}
        </button>
      </div>
    </form>
  )
}
