'use client'

import Link from 'next/link'

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
  const qtySuffix = quantity > 1 ? `&qty=${quantity}` : ''
  const checkoutHref = `/checkout?listing_id=${listingId}${qtySuffix}`

  // Plain Link — checkout page handles its own auth redirect (with the
  // same `next=` round-trip we'd build here), so doing it client-side
  // duplicates the logic and risks a hung "Processing…" if the auth
  // call stalls on gotrue-lock contention from other components on the
  // card page.
  return (
    <Link
      href={checkoutHref}
      className={`${SIZE_CLASSES[size]} rounded-lg font-semibold transition-colors cursor-pointer bg-orange-500 hover:bg-orange-600 text-white inline-flex items-center justify-center`}
    >
      Buy Now
    </Link>
  )
}
