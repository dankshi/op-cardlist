-- ============================================
-- ADMIN OUTBOUND LABEL URL
-- Persist the platform→buyer label PDF URL so admin can re-download the label
-- from the admin order detail page. Previously only tracking_number/carrier
-- were stored, which meant the PDF was unrecoverable after generation.
-- ============================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS outbound_label_url TEXT,
  ADD COLUMN IF NOT EXISTS outbound_label_cost NUMERIC(10,2);
