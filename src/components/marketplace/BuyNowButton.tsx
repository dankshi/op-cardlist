'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Size = 'sm' | 'lg'

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-sm',
  lg: 'px-6 py-3 text-base',
}

export function BuyNowButton({
  listingId,
  quantity = 1,
  size = 'sm',
}: {
  listingId: string
  price: number
  /** Units to purchase. Defaults to 1. The card-page buy panel passes
   *  >1 when the buyer used the qty stepper on a raw multi-stock
   *  listing. Threaded through checkout via `&qty=N` so the payment-
   *  intent route can size the Stripe charge accordingly. */
  quantity?: number
  size?: Size
}) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const qtySuffix = quantity > 1 ? `&qty=${quantity}` : ''
  const checkoutHref = `/checkout?listing_id=${listingId}${qtySuffix}`

  async function handleBuyNow() {
    setLoading(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push(`/auth/sign-in?next=${encodeURIComponent(checkoutHref)}`)
      return
    }

    router.push(checkoutHref)
  }

  return (
    <button
      onClick={handleBuyNow}
      disabled={loading}
      className={`${SIZE_CLASSES[size]} rounded-lg font-semibold transition-colors cursor-pointer bg-orange-500 hover:bg-orange-600 text-white disabled:bg-orange-700 disabled:cursor-not-allowed`}
    >
      {loading ? 'Processing…' : 'Buy Now'}
    </button>
  )
}
