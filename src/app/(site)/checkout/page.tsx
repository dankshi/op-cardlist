import type { Metadata } from 'next'
import CheckoutForm from '@/components/checkout/CheckoutForm'

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false },
}

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ listing_id?: string; qty?: string }>
}) {
  const params = await searchParams
  const listingId = params.listing_id
  // qty=N for multi-quantity Buy Now. Default 1; cap to a sane upper
  // bound here so a hand-edited URL can't request something absurd
  // (server still re-validates against listing.quantity_available).
  const qtyRaw = params.qty ? Number(params.qty) : 1
  const quantity = Number.isFinite(qtyRaw) && qtyRaw >= 1 && qtyRaw <= 99 ? Math.floor(qtyRaw) : 1

  if (!listingId) {
    return (
      <div className="max-w-lg mx-auto text-center py-20">
        <h1 className="text-2xl font-bold text-zinc-900 mb-3">No listing selected</h1>
        <p className="text-zinc-500">Please select a card to purchase from the marketplace.</p>
      </div>
    )
  }

  return <CheckoutForm listingId={listingId} quantity={quantity} />
}
