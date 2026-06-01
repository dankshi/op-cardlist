import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Order Confirmed',
  robots: { index: false },
}

export default async function CheckoutSuccessPage({ searchParams }: { searchParams: Promise<{ order_id?: string }> }) {
  const params = await searchParams
  const orderId = params.order_id

  // Fetch the order's current status so we can show the right copy if
  // Stripe Radar or our risk check flagged it. The webhook may not have
  // landed by the time the user redirects here — `pending_payment` shown
  // briefly is fine, but `under_review` needs a different message.
  let status: string | null = null
  if (orderId) {
    try {
      const supabase = await createClient()
      const { data } = await supabase.from('orders').select('status').eq('id', orderId).single()
      status = (data?.status as string) ?? null
    } catch {
      // Best-effort — fall through to the generic confirmation copy.
    }
  }

  const isUnderReview = status === 'under_review'

  return (
    <div className="max-w-lg mx-auto text-center py-20">
      <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 ${
        isUnderReview ? 'bg-amber-500/10' : 'bg-green-500/10'
      }`}>
        {isUnderReview ? (
          <svg className="w-10 h-10 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ) : (
          <svg className="w-10 h-10 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
      <h1 className="text-3xl font-bold text-zinc-900 mb-3">
        {isUnderReview ? 'Order Received — Under Review' : 'Order Confirmed!'}
      </h1>
      <p className="text-zinc-500 mb-8">
        {isUnderReview
          ? "Your payment went through and we're doing a quick fraud check. This usually clears within 24 hours — we'll email you when it's done. No action needed."
          : 'Your payment was successful. The seller will ship your card to our authentication center. Once verified, we’ll ship it to you.'}
      </p>
      {orderId && (
        <p className="text-sm text-zinc-500 mb-6">Order ID: {orderId.slice(0, 8)}...</p>
      )}
      <div className="flex gap-4 justify-center">
        <Link
          href={orderId ? `/orders/${orderId}` : '/orders'}
          className="px-6 py-3 rounded-lg bg-orange-500 hover:bg-orange-500 text-white font-semibold transition-colors"
        >
          View Order
        </Link>
        <Link
          href="/"
          className="px-6 py-3 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors"
        >
          Continue Shopping
        </Link>
      </div>
    </div>
  )
}
