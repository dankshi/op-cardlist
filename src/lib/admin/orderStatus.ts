// Single source of truth for order-status presentation across the admin
// app — the navbar dropdown, the orders list, and the order master view
// all read from here. Previously these tables were copy-pasted into the
// list and detail pages and drifted out of sync.

export const STATUS_STYLES: Record<string, string> = {
  pending_payment: 'bg-zinc-200 text-zinc-600',
  under_review: 'bg-amber-500/10 text-amber-600',
  paid: 'bg-yellow-500/10 text-yellow-600',
  seller_shipped: 'bg-blue-500/10 text-blue-600',
  received: 'bg-purple-500/10 text-purple-600',
  exception_review: 'bg-amber-500/15 text-amber-700',
  authenticated: 'bg-emerald-500/10 text-emerald-600',
  shipped_to_buyer: 'bg-indigo-500/10 text-indigo-600',
  shipped: 'bg-blue-500/10 text-blue-600',
  delivered: 'bg-green-500/10 text-green-600',
  cancelled: 'bg-red-500/10 text-red-600',
  refunded: 'bg-zinc-200 text-zinc-500',
  disputed: 'bg-rose-500/10 text-rose-600',
}

export const STATUS_LABELS: Record<string, string> = {
  pending_payment: 'Pending Payment',
  under_review: 'Under Review',
  paid: 'Paid — Awaiting Ship',
  seller_shipped: 'Seller Shipped',
  received: 'Received — Awaiting Authentication',
  exception_review: 'Exception Review',
  authenticated: 'Authenticated',
  shipped_to_buyer: 'Shipped to Buyer',
  shipped: 'Shipped (legacy)',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  disputed: 'Disputed',
}

// Ordered top-to-bottom by where the admin needs to take action soonest.
// Active states (things waiting on us) come first; terminal/historical
// states sit at the bottom and start collapsed. exception_review goes at
// the very top — flagged items need resolution before anything else can
// progress, and a stuck exception_review order is the loudest "ops debt
// is accumulating" signal we have.
export const STATUS_ORDER: { key: string; defaultOpen: boolean }[] = [
  { key: 'exception_review', defaultOpen: true },
  { key: 'under_review', defaultOpen: true },
  { key: 'paid', defaultOpen: true },
  { key: 'seller_shipped', defaultOpen: true },
  { key: 'received', defaultOpen: true },
  { key: 'authenticated', defaultOpen: true },
  { key: 'shipped_to_buyer', defaultOpen: false },
  { key: 'delivered', defaultOpen: false },
  { key: 'disputed', defaultOpen: false },
  { key: 'cancelled', defaultOpen: false },
  { key: 'refunded', defaultOpen: false },
  { key: 'pending_payment', defaultOpen: false },
]

// Forward fulfillment pipeline (excludes side-branches like
// exception_review / under_review). Used by the master-view stepper.
export const PIPELINE_STEPS: { key: string; label: string }[] = [
  { key: 'paid', label: 'Paid' },
  { key: 'seller_shipped', label: 'Seller Shipped' },
  { key: 'received', label: 'Received' },
  { key: 'authenticated', label: 'Authenticated' },
  { key: 'shipped_to_buyer', label: 'Shipped to Buyer' },
  { key: 'delivered', label: 'Delivered' },
]

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] || status
}

export function statusStyle(status: string): string {
  return STATUS_STYLES[status] || 'bg-zinc-200 text-zinc-600'
}
