-- ============================================
-- Intake System: per-item verification & issue tracking
-- ============================================

-- 1. Add intake columns to order_items
ALTER TABLE order_items ADD COLUMN intake_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (intake_status IN ('pending','verified','flagged','resolved','rejected'));
ALTER TABLE order_items ADD COLUMN intake_verified_at TIMESTAMPTZ;
ALTER TABLE order_items ADD COLUMN intake_verified_by UUID REFERENCES profiles(id);
ALTER TABLE order_items ADD COLUMN intake_notes TEXT;

-- 2. Intake issues table
CREATE TABLE intake_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id UUID REFERENCES order_items(id) ON DELETE SET NULL,
  issue_type TEXT NOT NULL CHECK (issue_type IN (
    'wrong_card','wrong_condition','missing_item','counterfeit',
    'damaged_in_transit','wrong_quantity','other'
  )),
  description TEXT NOT NULL,
  expected_card_name TEXT,
  received_card_name TEXT,
  expected_condition TEXT,
  received_condition TEXT,
  photo_urls TEXT[] DEFAULT '{}',
  resolution_status TEXT NOT NULL DEFAULT 'open'
    CHECK (resolution_status IN ('open','in_progress','resolved','escalated')),
  resolution_type TEXT CHECK (resolution_type IN (
    'replacement_requested','partial_refund','full_refund',
    'order_cancelled','item_accepted','new_item_created','seller_contacted'
  )),
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES profiles(id),
  seller_notified_at TIMESTAMPTZ,
  buyer_notified_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Intake activity log (immutable audit trail)
CREATE TABLE intake_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id UUID REFERENCES order_items(id) ON DELETE SET NULL,
  intake_issue_id UUID REFERENCES intake_issues(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  performed_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Indexes for common queries
CREATE INDEX idx_intake_issues_order_id ON intake_issues(order_id);
CREATE INDEX idx_intake_issues_resolution_status ON intake_issues(resolution_status);
CREATE INDEX idx_intake_issues_issue_type ON intake_issues(issue_type);
CREATE INDEX idx_intake_activity_log_order_id ON intake_activity_log(order_id);
CREATE INDEX idx_order_items_intake_status ON order_items(intake_status);

-- 5. RLS policies
ALTER TABLE intake_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_activity_log ENABLE ROW LEVEL SECURITY;

-- Admins can do everything with intake_issues
CREATE POLICY "Admins can manage intake issues"
  ON intake_issues FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Order participants can view intake issues on their orders
CREATE POLICY "Order participants can view intake issues"
  ON intake_issues FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = intake_issues.order_id
        AND (orders.buyer_id = auth.uid() OR orders.seller_id = auth.uid())
    )
  );

-- Admins can do everything with activity log
CREATE POLICY "Admins can manage intake activity log"
  ON intake_activity_log FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Order participants can view activity log on their orders
CREATE POLICY "Order participants can view intake activity log"
  ON intake_activity_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = intake_activity_log.order_id
        AND (orders.buyer_id = auth.uid() OR orders.seller_id = auth.uid())
    )
  );
