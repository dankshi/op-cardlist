import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Order Confirmed',
  robots: { index: false },
}

export default async function CheckoutSuccessPage({ searchParams }: { searchParams: Promise<{ order_id?: string }> }) {
  const params = await searchParams
  const orderId = params.order_id

  return (
    <div className="max-w-lg mx-auto text-center py-20">
      <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
        <svg className="w-10 h-10 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h1 className="text-3xl font-bold text-zinc-900 mb-3">Order Confirmed!</h1>
      <p className="text-zinc-500 mb-8">
        Your payment was successful. The seller will ship your card to our authentication center. Once verified, we&rsquo;ll ship it to you.
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
