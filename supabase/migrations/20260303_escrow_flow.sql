-- ============================================
-- ESCROW FLOW: New statuses, admin role, order fields
-- ============================================

-- Add new order statuses for escrow pipeline
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'seller_shipped' AFTER 'paid';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'received' AFTER 'seller_shipped';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'authenticated' AFTER 'received';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'shipped_to_buyer' AFTER 'authenticated';

-- Add admin role to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Add escrow-specific columns to orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS seller_tracking_number TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS seller_tracking_carrier TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS seller_label_url TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS seller_label_cost NUMERIC(10,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS admin_notes TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS authenticated_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipped_to_buyer_at TIMESTAMPTZ;

-- Admin RLS policies
CREATE POLICY "Admins can see all orders"
  ON orders FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

CREATE POLICY "Admins can update all orders"
  ON orders FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

CREATE POLICY "Admins can see all order items"
  ON order_items FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );
