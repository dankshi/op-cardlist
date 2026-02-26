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
  shipped: 'bg-blue-500/10 text-blue-400',
  delivered: 'bg-green-500/10 text-green-400',
  cancelled: 'bg-red-500/10 text-red-400',
  refunded: 'bg-zinc-200 text-zinc-500',
  disputed: 'bg-red-500/10 text-red-400',
}

const STATUS_LABELS: Record<string, string> = {
  pending_payment: 'Pending Payment',
  paid: 'Paid',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  disputed: 'Disputed',
}

export default function OrderDetailPage() {
  const [order, setOrder] = useState<Order | null>(null)
  const [review, setReview] = useState<Review | null>(null)
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [reviewRating, setReviewRating] = useState(5)
  const [reviewComment, setReviewComment] = useState('')
  const [submittingReview, setSubmittingReview] = useState(false)
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

      // Get order items
      const { data: items } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', orderId)

      const fullOrder = { ...orderData, items: items || [] } as Order
      setOrder(fullOrder)

      // Check for existing review
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

  return (
    <div className="max-w-3xl mx-auto">
      <Link href="/orders" className="text-sm text-zinc-500 hover:text-zinc-700 mb-4 inline-block">
        &larr; Back to Orders
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

      {/* Order Items */}
      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-zinc-200">
          <h2 className="font-medium text-zinc-900">Items</h2>
        </div>
        <div className="divide-y divide-zinc-200">
          {order.items?.map(item => (
            <div key={item.id} className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                {item.snapshot_photo_url && (
                  <img src={item.snapshot_photo_url} alt="" className="w-10 h-14 object-contain rounded" />
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
        <div className="bg-white border border-zinc-200 rounded-lg p-4">
          <h2 className="font-medium text-zinc-900 mb-3">{isBuyer ? 'Seller' : 'Buyer'}</h2>
          {isBuyer && order.seller ? (
            <Link href={`/seller/${(order.seller as { username: string }).username}`} className="text-orange-400 hover:text-orange-600">
              {(order.seller as { display_name: string }).display_name}
            </Link>
          ) : order.buyer ? (
            <p className="text-zinc-600">{(order.buyer as { display_name: string }).display_name}</p>
          ) : null}
        </div>

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

      {/* Tracking Info */}
      {order.tracking_number && (
        <div className="bg-white border border-zinc-200 rounded-lg p-4 mb-6">
          <h2 className="font-medium text-zinc-900 mb-2">Tracking</h2>
          <p className="text-zinc-600">
            {order.tracking_carrier && <span className="text-zinc-500">{order.tracking_carrier}: </span>}
            {order.tracking_number}
          </p>
          {order.shipped_at && (
            <p className="text-xs text-zinc-500 mt-1">
              Shipped {new Date(order.shipped_at).toLocaleDateString()}
            </p>
          )}
        </div>
      )}

      {/* Seller: Mark as shipped */}
      {isSeller && order.status === 'paid' && (
        <div className="bg-white border border-zinc-200 rounded-lg p-4 mb-6">
          <h2 className="font-medium text-zinc-900 mb-3">Ship This Order</h2>
          <form onSubmit={async (e) => {
            e.preventDefault()
            const form = e.target as HTMLFormElement
            const trackingNumber = (form.elements.namedItem('tracking') as HTMLInputElement).value
            const carrier = (form.elements.namedItem('carrier') as HTMLInputElement).value

            await supabase
              .from('orders')
              .update({
                status: 'shipped',
                tracking_number: trackingNumber || null,
                tracking_carrier: carrier || null,
                shipped_at: new Date().toISOString(),
              })
              .eq('id', order.id)

            setOrder({ ...order, status: 'shipped', tracking_number: trackingNumber, tracking_carrier: carrier, shipped_at: new Date().toISOString() })
          }} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <input name="carrier" placeholder="Carrier (e.g., USPS)" className="px-3 py-2 rounded-lg bg-zinc-100 border border-zinc-200 text-zinc-900 placeholder-zinc-400 text-sm" />
              <input name="tracking" placeholder="Tracking number" className="px-3 py-2 rounded-lg bg-zinc-100 border border-zinc-200 text-zinc-900 placeholder-zinc-400 text-sm" />
            </div>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-500 text-white font-semibold text-sm transition-colors cursor-pointer">
              Mark as Shipped
            </button>
          </form>
        </div>
      )}

      {/* Buyer: Confirm delivery */}
      {isBuyer && order.status === 'shipped' && (
        <div className="bg-white border border-zinc-200 rounded-lg p-4 mb-6">
          <p className="text-zinc-600 mb-3">Have you received this order?</p>
          <button
            onClick={async () => {
              await supabase
                .from('orders')
                .update({ status: 'delivered', delivered_at: new Date().toISOString() })
                .eq('id', order.id)
              setOrder({ ...order, status: 'delivered', delivered_at: new Date().toISOString() })
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
            className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-500 text-white font-semibold text-sm transition-colors cursor-pointer disabled:opacity-50"
          >
            {submittingReview ? 'Submitting...' : 'Submit Review'}
          </button>
        </div>
      )}
    </div>
  )
}
