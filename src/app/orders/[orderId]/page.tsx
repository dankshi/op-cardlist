'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { ConditionBadge } from '@/components/marketplace/ConditionBadge'
import type { Order, Review, CardCondition } from '@/types/database'

const STATUS_STYLES: Record<string, string> = {
  pending_payment: 'bg-zinc-200 text-zinc-600',
  paid: 'bg-yellow-500/10 text-yellow-400',
  seller_shipped: 'bg-blue-500/10 text-blue-400',
  received: 'bg-purple-500/10 text-purple-400',
  authenticated: 'bg-emerald-500/10 text-emerald-400',
  shipped_to_buyer: 'bg-blue-500/10 text-blue-400',
  shipped: 'bg-blue-500/10 text-blue-400',
  delivered: 'bg-green-500/10 text-green-400',
  cancelled: 'bg-red-500/10 text-red-400',
  refunded: 'bg-zinc-200 text-zinc-500',
  disputed: 'bg-red-500/10 text-red-400',
}

const STATUS_LABELS: Record<string, string> = {
  pending_payment: 'Pending Payment',
  paid: 'Paid — Awaiting Shipment',
  seller_shipped: 'Shipped to Platform',
  received: 'Received by Platform',
  authenticated: 'Authenticated',
  shipped_to_buyer: 'Shipped to You',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  disputed: 'Disputed',
}

const PIPELINE_STEPS = [
  { key: 'paid', label: 'Paid' },
  { key: 'seller_shipped', label: 'Shipped' },
  { key: 'received', label: 'Received' },
  { key: 'authenticated', label: 'Authenticated' },
  { key: 'shipped_to_buyer', label: 'On the Way' },
  { key: 'delivered', label: 'Delivered' },
]

function PipelineStepper({ currentStatus }: { currentStatus: string }) {
  const currentIndex = PIPELINE_STEPS.findIndex(s => s.key === currentStatus)
  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-4 mb-6">
      <h2 className="font-medium text-zinc-900 mb-4">Order Progress</h2>
      <div className="flex items-center justify-between">
        {PIPELINE_STEPS.map((step, i) => {
          const isComplete = i <= currentIndex
          const isCurrent = i === currentIndex
          return (
            <div key={step.key} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                  isComplete
                    ? 'bg-orange-500 text-white'
                    : 'bg-zinc-100 text-zinc-400'
                } ${isCurrent ? 'ring-2 ring-orange-500 ring-offset-2' : ''}`}>
                  {isComplete && i < currentIndex ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  ) : (
                    i + 1
                  )}
                </div>
                <span className={`text-xs mt-1 ${isComplete ? 'text-zinc-900 font-medium' : 'text-zinc-400'}`}>
                  {step.label}
                </span>
              </div>
              {i < PIPELINE_STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-2 mt-[-16px] ${i < currentIndex ? 'bg-orange-500' : 'bg-zinc-200'}`} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function OrderDetailPage() {
  const [order, setOrder] = useState<Order | null>(null)
  const [review, setReview] = useState<Review | null>(null)
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [reviewRating, setReviewRating] = useState(5)
  const [reviewComment, setReviewComment] = useState('')
  const [submittingReview, setSubmittingReview] = useState(false)
  const [labelLoading, setLabelLoading] = useState(false)
  const [estimateLoading, setEstimateLoading] = useState(false)
  const [estimate, setEstimate] = useState<{ estimated_cost: number; carrier: string; estimated_days: number } | null>(null)
  const [shipLoading, setShipLoading] = useState(false)
  const [cardImages, setCardImages] = useState<Record<string, string>>({})
  const router = useRouter()
  const params = useParams()
  const orderId = params.orderId as string
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth/sign-in'); return }
      setUserId(user.id)

      const { data: orderData } = await supabase
        .from('orders')
        .select('*, buyer:profiles!orders_buyer_id_fkey(display_name, username, avatar_url), seller:profiles!orders_seller_id_fkey(display_name, username, avatar_url)')
        .eq('id', orderId)
        .single()

      if (!orderData || (orderData.buyer_id !== user.id && orderData.seller_id !== user.id)) {
        router.push('/orders')
        return
      }

      const { data: items } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', orderId)

      const fullOrder = { ...orderData, items: items || [] } as Order
      setOrder(fullOrder)

      // Fetch card images for items without snapshots
      const cardIds = [...new Set((items || []).filter(i => !i.snapshot_photo_url).map(i => i.card_id))]
      const imgs: Record<string, string> = {}
      await Promise.all(
        cardIds.map(async (cardId: string) => {
          try {
            const r = await fetch(`/api/cards?id=${encodeURIComponent(cardId)}`)
            const d = await r.json()
            if (d.card?.imageUrl) imgs[cardId] = d.card.imageUrl
          } catch { /* skip */ }
        })
      )
      setCardImages(imgs)

      const { data: reviewData } = await supabase
        .from('reviews')
        .select('*')
        .eq('order_id', orderId)
        .single()

      if (reviewData) setReview(reviewData as Review)
      setLoading(false)
    }
    load()
  }, [supabase, router, orderId])

  async function getEstimate() {
    setEstimateLoading(true)
    const res = await fetch(`/api/orders/${orderId}/label/estimate`)
    const data = await res.json()
    if (res.ok) {
      setEstimate(data)
    } else {
      alert(data.error || 'Failed to get estimate')
    }
    setEstimateLoading(false)
  }

  async function generateLabel() {
    if (!order) return
    setLabelLoading(true)
    const res = await fetch(`/api/orders/${orderId}/label`, { method: 'POST' })
    const data = await res.json()
    if (res.ok) {
      setOrder({
        ...order,
        seller_label_url: data.label_url,
        seller_label_cost: data.cost,
        seller_tracking_number: data.tracking_number,
        seller_tracking_carrier: data.carrier,
      })
    } else {
      alert(data.error || 'Label generation failed')
    }
    setLabelLoading(false)
  }

  async function markAsShipped() {
    if (!order) return
    setShipLoading(true)
    const res = await fetch(`/api/orders/${order.id}/ship`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (res.ok) {
      setOrder({ ...order, status: 'seller_shipped' as Order['status'], shipped_at: new Date().toISOString() })
    } else {
      const data = await res.json()
      alert(data.error || 'Failed to mark as shipped')
    }
    setShipLoading(false)
  }

  async function submitReview() {
    if (!order || !userId) return
    setSubmittingReview(true)
    const { data, error } = await supabase
      .from('reviews')
      .insert({
        order_id: order.id,
        reviewer_id: userId,
        seller_id: order.seller_id,
        rating: reviewRating,
        comment: reviewComment || null,
      })
      .select()
      .single()

    if (!error && data) {
      setReview(data as Review)
    }
    setSubmittingReview(false)
  }

  if (loading) {
    return (
      <div className="py-20 text-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  if (!order) return null

  const isBuyer = userId === order.buyer_id
  const isSeller = userId === order.seller_id
  const canReview = isBuyer && order.status === 'delivered' && !review
  const platformAddress = process.env.NEXT_PUBLIC_PLATFORM_ADDRESS || ''

  return (
    <div className="max-w-3xl mx-auto">
      <Link href={isSeller ? '/dashboard' : '/orders'} className="text-sm text-zinc-500 hover:text-zinc-700 mb-4 inline-block">
        &larr; {isSeller ? 'Back to My Shop' : 'Back to Orders'}
      </Link>

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900">Order #{order.id.slice(0, 8)}</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Placed {new Date(order.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <span className={`text-sm px-3 py-1 rounded-full font-medium ${STATUS_STYLES[order.status] || ''}`}>
          {STATUS_LABELS[order.status] || order.status}
        </span>
      </div>

      {/* Pipeline Stepper */}
      {['paid', 'seller_shipped', 'received', 'authenticated', 'shipped_to_buyer', 'delivered'].includes(order.status) && (
        <PipelineStepper currentStatus={order.status} />
      )}

      {/* Order Items */}
      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-zinc-200">
          <h2 className="font-medium text-zinc-900">Items</h2>
        </div>
        <div className="divide-y divide-zinc-200">
          {order.items?.map(item => (
            <div key={item.id} className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                {(item.snapshot_photo_url || cardImages[item.card_id]) && (
                  <img src={item.snapshot_photo_url || cardImages[item.card_id]} alt="" className="w-16 h-[89px] object-cover rounded" />
                )}
                <div>
                  <Link href={`/card/${item.card_id.toLowerCase()}`} className="font-medium text-zinc-900 hover:text-orange-400 transition-colors">
                    {item.card_name || item.card_id}
                  </Link>
                  <div className="flex items-center gap-2 mt-1">
                    <ConditionBadge condition={item.condition as CardCondition} />
                    <span className="text-xs text-zinc-500">x{item.quantity}</span>
                  </div>
                </div>
              </div>
              <p className="text-zinc-900 font-medium">${(Number(item.unit_price) * item.quantity).toFixed(2)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Order Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {isBuyer && (
          <div className="bg-white border border-zinc-200 rounded-lg p-4">
            <h2 className="font-medium text-zinc-900 mb-3">Seller</h2>
            {order.seller ? (
              <Link href={`/seller/${(order.seller as { username: string }).username}`} className="text-orange-400 hover:text-orange-600">
                {(order.seller as { display_name: string }).display_name}
              </Link>
            ) : null}
          </div>
        )}

        <div className="bg-white border border-zinc-200 rounded-lg p-4">
          <h2 className="font-medium text-zinc-900 mb-3">Summary</h2>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-zinc-500">
              <span>Subtotal</span>
              <span>${Number(order.subtotal).toFixed(2)}</span>
            </div>
            {order.shipping_cost > 0 && (
              <div className="flex justify-between text-zinc-500">
                <span>Shipping</span>
                <span>${Number(order.shipping_cost).toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-zinc-900 font-bold pt-1 border-t border-zinc-200">
              <span>Total</span>
              <span>${Number(order.total).toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tracking: Seller to Platform */}
      {order.seller_tracking_number && (
        <div className="bg-white border border-zinc-200 rounded-lg p-4 mb-6">
          <h2 className="font-medium text-zinc-900 mb-2">Tracking — {isBuyer ? 'To Authentication' : 'To Platform'}</h2>
          <p className="text-zinc-600">
            {order.seller_tracking_carrier && <span className="text-zinc-500">{order.seller_tracking_carrier}: </span>}
            {order.seller_tracking_number}
          </p>
          {order.shipped_at && (
            <p className="text-xs text-zinc-500 mt-1">
              Shipped {new Date(order.shipped_at).toLocaleDateString()}
            </p>
          )}
        </div>
      )}

      {/* Tracking: Platform to Buyer */}
      {order.tracking_number && (
        <div className="bg-white border border-zinc-200 rounded-lg p-4 mb-6">
          <h2 className="font-medium text-zinc-900 mb-2">Tracking — To {isBuyer ? 'You' : 'Buyer'}</h2>
          <p className="text-zinc-600">
            {order.tracking_carrier && <span className="text-zinc-500">{order.tracking_carrier}: </span>}
            {order.tracking_number}
          </p>
          {order.shipped_to_buyer_at && (
            <p className="text-xs text-zinc-500 mt-1">
              Shipped {new Date(order.shipped_to_buyer_at).toLocaleDateString()}
            </p>
          )}
        </div>
      )}

      {/* Seller: Generate label & ship (status = paid, no label yet) */}
      {isSeller && order.status === 'paid' && !order.seller_label_url && (
        <div className="bg-white border border-zinc-200 rounded-lg p-4 mb-6">
          <h2 className="font-medium text-zinc-900 mb-3">Ship Your Card to Us</h2>

          {platformAddress && (
            <div className="bg-zinc-50 rounded-lg p-4 mb-4">
              <p className="text-sm font-medium text-zinc-900 mb-1">Ship to:</p>
              <p className="text-sm text-zinc-600">{platformAddress}</p>
            </div>
          )}

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
            <p className="text-sm text-amber-800 font-medium">Packing Instructions</p>
            <ul className="text-sm text-amber-700 mt-1 space-y-1 list-disc list-inside">
              <li>Place card in a top loader or card saver</li>
              <li>Wrap in bubble wrap or padding</li>
              <li>Use a rigid mailer or small box</li>
            </ul>
          </div>

          {!estimate ? (
            <button
              onClick={getEstimate}
              disabled={estimateLoading}
              className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm transition-colors cursor-pointer disabled:opacity-50"
            >
              {estimateLoading ? 'Getting estimate...' : 'Get Shipping Estimate'}
            </button>
          ) : (
            <div>
              <div className="bg-zinc-50 rounded-lg p-3 mb-3">
                <p className="text-sm text-zinc-900">
                  <span className="font-medium">Estimated cost:</span> ${estimate.estimated_cost.toFixed(2)} via {estimate.carrier}
                </p>
                <p className="text-xs text-zinc-500">Est. {estimate.estimated_days} days &middot; Deducted from your balance</p>
              </div>
              <button
                onClick={generateLabel}
                disabled={labelLoading}
                className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm transition-colors cursor-pointer disabled:opacity-50"
              >
                {labelLoading ? 'Generating label...' : `Generate Label — $${estimate.estimated_cost.toFixed(2)}`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Seller: Label generated, ready to ship */}
      {isSeller && order.status === 'paid' && order.seller_label_url && (
        <div className="bg-white border border-zinc-200 rounded-lg p-4 mb-6">
          <h2 className="font-medium text-zinc-900 mb-3">Your Shipping Label</h2>
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
            <p className="text-sm text-green-800">Label generated! Cost: ${Number(order.seller_label_cost || 0).toFixed(2)}</p>
          </div>
          <div className="flex gap-3 mb-4">
            <a
              href={order.seller_label_url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-lg border border-zinc-200 text-zinc-700 hover:bg-zinc-50 text-sm font-medium transition-colors"
            >
              Download Label (PDF)
            </a>
          </div>
          <button
            onClick={markAsShipped}
            disabled={shipLoading}
            className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm transition-colors cursor-pointer disabled:opacity-50"
          >
            {shipLoading ? 'Updating...' : 'I\'ve Shipped It — Mark as Shipped'}
          </button>
        </div>
      )}

      {/* Seller: Waiting for platform */}
      {isSeller && ['seller_shipped', 'received', 'authenticated', 'shipped_to_buyer'].includes(order.status) && (
        <div className="bg-white border border-zinc-200 rounded-lg p-4 mb-6">
          <h2 className="font-medium text-zinc-900 mb-2">
            {order.status === 'seller_shipped' && 'Card in Transit to Platform'}
            {order.status === 'received' && 'Card Being Reviewed'}
            {order.status === 'authenticated' && 'Card Authenticated — Shipping to Buyer'}
            {order.status === 'shipped_to_buyer' && 'Shipped to Buyer'}
          </h2>
          <p className="text-sm text-zinc-500">
            {order.status === 'seller_shipped' && 'We\'ll update you once we receive your card.'}
            {order.status === 'received' && 'We\'ve received your card and are verifying it.'}
            {order.status === 'authenticated' && 'Your card passed authentication! Your payout has been credited. We\'re shipping it to the buyer now.'}
            {order.status === 'shipped_to_buyer' && 'The card is on its way to the buyer. You\'ll be notified when it\'s delivered.'}
          </p>
        </div>
      )}

      {/* Buyer: Confirm delivery */}
      {isBuyer && order.status === 'shipped_to_buyer' && (
        <div className="bg-white border border-zinc-200 rounded-lg p-4 mb-6">
          <p className="text-zinc-600 mb-3">Have you received this order?</p>
          <button
            onClick={async () => {
              await supabase
                .from('orders')
                .update({ status: 'delivered', delivered_at: new Date().toISOString() })
                .eq('id', order.id)
              setOrder({ ...order, status: 'delivered' as Order['status'], delivered_at: new Date().toISOString() })
            }}
            className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white font-semibold text-sm transition-colors cursor-pointer"
          >
            Confirm Delivery
          </button>
        </div>
      )}

      {/* Review */}
      {review && (
        <div className="bg-white border border-zinc-200 rounded-lg p-4 mb-6">
          <h2 className="font-medium text-zinc-900 mb-2">Your Review</h2>
          <div className="flex items-center gap-1 mb-2">
            {[1, 2, 3, 4, 5].map(star => (
              <svg key={star} className={`w-5 h-5 ${star <= review.rating ? 'text-yellow-400' : 'text-zinc-600'}`} fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
            ))}
          </div>
          {review.comment && <p className="text-sm text-zinc-500">{review.comment}</p>}
        </div>
      )}

      {/* Leave Review */}
      {canReview && (
        <div className="bg-white border border-zinc-200 rounded-lg p-4 mb-6">
          <h2 className="font-medium text-zinc-900 mb-3">Leave a Review</h2>
          <div className="flex items-center gap-1 mb-3">
            {[1, 2, 3, 4, 5].map(star => (
              <button
                key={star}
                type="button"
                onClick={() => setReviewRating(star)}
                className="cursor-pointer"
              >
                <svg className={`w-7 h-7 ${star <= reviewRating ? 'text-yellow-400' : 'text-zinc-600'}`} fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
              </button>
            ))}
          </div>
          <textarea
            value={reviewComment}
            onChange={e => setReviewComment(e.target.value)}
            placeholder="How was your experience?"
            rows={3}
            className="w-full px-3 py-2 rounded-lg bg-zinc-100 border border-zinc-200 text-zinc-900 placeholder-zinc-400 text-sm resize-none mb-3"
          />
          <button
            onClick={submitReview}
            disabled={submittingReview}
            className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm transition-colors cursor-pointer disabled:opacity-50"
          >
            {submittingReview ? 'Submitting...' : 'Submit Review'}
          </button>
        </div>
      )}
    </div>
  )
}
