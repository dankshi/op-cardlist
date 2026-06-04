import { requireSeller } from '@/lib/auth'
import { SellerHubClient } from '@/components/sellerhub/SellerHubClient'

// Seller-only power dashboard. The casual card-grid view lives at
// /mystuff; this is the dense, table-first workspace for sellers who
// manage a lot of inventory (bulk create/price, inline edits, offers,
// orders with fee + label tooling).
export const dynamic = 'force-dynamic'

export default async function SellerHubPage() {
  // requireSeller redirects non-approved sellers to /seller/apply.
  const { user, profile } = await requireSeller()

  return <SellerHubClient userId={user.id} profile={profile} />
}
