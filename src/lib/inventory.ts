/**
 * Pure inventory-reservation logic.
 *
 * Marketplace stock moves through three transitions:
 *   1. RESERVE — at order creation. Atomically subtract the purchased
 *      quantity from `listings.quantity_available`. If that empties
 *      stock, flip status to `reserved` so the listing disappears from
 *      both the marketplace and the seller's Selling/Collection tabs
 *      while the buyer pays.
 *   2. FINALIZE — at webhook `paid`. Stock was already decremented at
 *      reserve time; just settle the status (sold if no stock left,
 *      active if some remains).
 *   3. RELEASE — at order cancel / payment fail. Restore the reserved
 *      quantity so other buyers can take it. Status flips back to
 *      `active`.
 *
 * Everything in this module is pure — no I/O, no Supabase. The routes
 * supply the listing snapshot and use the returned transition to issue
 * the actual UPDATE. Pure helpers + DB-side conditional updates keep
 * concurrent buyers safe (a race is decided by Postgres, not us).
 */

export type ListingStatus = 'active' | 'reserved' | 'sold' | 'delisted';

export interface ListingSnapshot {
  status: ListingStatus;
  quantity_available: number;
}

export interface ReservationResult {
  /** New `quantity_available` after subtracting the buyer's qty. */
  nextQuantityAvailable: number;
  /** New `status` after the reservation. */
  nextStatus: ListingStatus;
}

/**
 * Compute the listing state after a buyer reserves `qty` units.
 * Returns `null` when the reservation is invalid (insufficient stock,
 * listing not for sale). Callers should treat null as "race lost" and
 * refuse the order.
 */
export function reserveListing(
  listing: ListingSnapshot,
  qty: number,
): ReservationResult | null {
  if (qty <= 0) return null;
  // Already reserved means another buyer is mid-checkout for the last
  // unit — only allow if there's still quantity to take. (Multi-qty
  // listings can keep accepting orders while reserved if stock remains;
  // single-qty listings will always fail this check.)
  if (listing.status !== 'active' && listing.status !== 'reserved') return null;
  if (listing.quantity_available < qty) return null;

  const nextQuantityAvailable = listing.quantity_available - qty;
  const nextStatus: ListingStatus =
    nextQuantityAvailable === 0 ? 'reserved' : 'active';

  return { nextQuantityAvailable, nextStatus };
}

/**
 * Compute the listing state after the buyer's payment confirms.
 * Stock was already decremented at reservation time — this only
 * settles the status. Returns the next status; callers UPDATE listings
 * with just that.
 *
 * For multi-quantity listings with concurrent buyers, we conservatively
 * keep `reserved` until stock is restored or fully sold. The status
 * sweeper (or the next release/finalize event) will eventually settle
 * it. In the common single-qty case, this is `'sold'`.
 */
export function finalizeSale(listing: ListingSnapshot): ListingStatus {
  if (listing.quantity_available === 0) return 'sold';
  // Stock remains — flip back to active so other buyers can browse it.
  return 'active';
}

/**
 * Compute the listing state after releasing a reservation (cancel,
 * payment failure, stale-order cleanup). Restores the buyer's qty to
 * `quantity_available` and flips status back to `active`.
 *
 * Returns `null` if the listing is delisted or sold — in that case the
 * inventory is no longer recoverable to active and the caller should
 * skip the restore (we leave the row alone and credit the buyer).
 */
export function releaseReservation(
  listing: ListingSnapshot,
  qty: number,
): ReservationResult | null {
  if (qty <= 0) return null;
  if (listing.status === 'sold' || listing.status === 'delisted') return null;

  const nextQuantityAvailable = listing.quantity_available + qty;
  // Restoring stock always returns the listing to the marketplace.
  return { nextQuantityAvailable, nextStatus: 'active' };
}
