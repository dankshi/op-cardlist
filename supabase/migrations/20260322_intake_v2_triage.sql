-- ============================================
-- Intake V2: Tracking-first flow with triage
-- ============================================

-- 1. Triage packages table (unmatched packages awaiting resolution)
CREATE TABLE triage_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  triage_type TEXT NOT NULL CHECK (triage_type IN ('no_order', 'user_id')),
  tracking_number TEXT,
  seller_id UUID REFERENCES profiles(id),
  card_type TEXT CHECK (card_type IN ('raw', 'slab')),
  cert_number TEXT,
  nomi_input TEXT,
  resolved_order_id UUID REFERENCES orders(id),
  resolved_as TEXT CHECK (resolved_as IN ('matched_order', 'house_account')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  created_by UUID NOT NULL REFERENCES profiles(id),
  resolved_by UUID REFERENCES profiles(id),
  resolved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Index on seller_tracking_number for fast lookup
CREATE INDEX IF NOT EXISTS idx_orders_seller_tracking_number ON orders(seller_tracking_number);

-- 3. Track how a package was received
ALTER TABLE orders ADD COLUMN IF NOT EXISTS received_via TEXT
  CHECK (received_via IN ('tracking_scan', 'pon_scan', 'triage_resolution', 'manual'));

-- 4. House account: create auth user first, then profile
-- The profiles table has FK to auth.users, so we need the auth user to exist
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'house-account@internal.nomi.cards',
  '$2a$10$placeholder_not_a_real_password_hash_000000000000000',
  now(),
  now(),
  now(),
  '',
  ''
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, username, display_name, is_admin, is_seller, seller_approved)
VALUES ('00000000-0000-0000-0000-000000000001', 'house-account', 'House Account', false, true, true)
ON CONFLICT (id) DO NOTHING;

-- 5. Indexes for triage queries
CREATE INDEX idx_triage_packages_status ON triage_packages(status);
CREATE INDEX idx_triage_packages_triage_type ON triage_packages(triage_type);
CREATE INDEX idx_triage_packages_seller_id ON triage_packages(seller_id);

-- 6. RLS policies for triage_packages
ALTER TABLE triage_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage triage packages"
  ON triage_packages FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );
