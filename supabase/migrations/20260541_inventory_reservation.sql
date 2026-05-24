-- ============================================
-- INVENTORY RESERVATION
-- Tracks whether stock was decremented at order creation. New orders
-- reserve inventory atomically up front (status → 'reserved' if it
-- empties stock). Legacy orders predating this change get FALSE and the
-- webhook falls back to the pre-reservation logic so in-flight orders
-- still land correctly.
-- ============================================

ALTER TABLE orders
  ADD COLUMN inventory_reserved BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN orders.inventory_reserved IS
  'TRUE when payment-intent / checkout decremented listing.quantity_available at order creation. The webhook reads this on `paid` to know whether to skip the legacy decrement.';
