import Link from 'next/link'

/** Header link to the buyer's Collection (portfolio). Seller tooling lives in
 *  /sellerhub (reachable from the account dropdown), so this no longer carries
 *  the seller "awaiting shipment" badge. */
export default function MyShopLink() {
  return (
    <Link href="/collection" className="text-white/80 hover:text-white transition-colors text-sm font-medium">
      Collection
    </Link>
  )
}
