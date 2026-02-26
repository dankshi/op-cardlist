import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Checkout Cancelled',
  robots: { index: false },
}

export default function CheckoutCancelPage() {
  return (
    <div className="max-w-lg mx-auto text-center py-20">
      <div className="w-20 h-20 bg-zinc-700/50 light:bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
        <svg className="w-10 h-10 text-zinc-400 light:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
      <h1 className="text-3xl font-bold text-zinc-100 light:text-gray-900 mb-3">Checkout Cancelled</h1>
      <p className="text-zinc-400 light:text-gray-500 mb-8">
        Your payment was not processed. Your cart items are still saved.
      </p>
      <div className="flex gap-4 justify-center">
        <Link
          href="/cart"
          className="px-6 py-3 rounded-lg bg-orange-500 hover:bg-orange-500 text-white font-semibold transition-colors"
        >
          Return to Cart
        </Link>
        <Link
          href="/"
          className="px-6 py-3 rounded-lg border border-zinc-700 light:border-gray-300 text-zinc-300 light:text-gray-600 hover:bg-zinc-800 light:hover:bg-gray-50 transition-colors"
        >
          Continue Shopping
        </Link>
      </div>
    </div>
  )
}
