-- ============================================
-- MARKETPLACE SCHEMA: Listings, Cart, Orders, Reviews
-- ============================================

-- Card condition enum
CREATE TYPE card_condition AS ENUM (
  'near_mint', 'lightly_played', 'moderately_played', 'heavily_played', 'damaged'
);

-- Listing status enum
CREATE TYPE listing_status AS ENUM (
  'active', 'sold', 'reserved', 'delisted'
);

-- Order status enum
CREATE TYPE order_status AS ENUM (
  'pending_payment', 'paid', 'shipped', 'delivered', 'cancelled', 'refunded', 'disputed'
);

-- ============================================
-- LISTINGS: Cards for sale by sellers
-- ============================================
CREATE TABLE listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  condition card_condition NOT NULL DEFAULT 'near_mint',
  price NUMERIC(10,2) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  quantity_available INTEGER NOT NULL DEFAULT 1,
  language TEXT DEFAULT 'EN',
  is_first_edition BOOLEAN DEFAULT FALSE,
  photo_urls TEXT[] DEFAULT '{}',
  status listing_status NOT NULL DEFAULT 'active',
  tcgplayer_product_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_listings_card_id ON listings(card_id) WHERE status = 'active';
CREATE INDEX idx_listings_seller ON listings(seller_id) WHERE status = 'active';
CREATE INDEX idx_listings_status ON listings(status);
CREATE INDEX idx_listings_price ON listings(price) WHERE status = 'active';
CREATE INDEX idx_listings_created ON listings(created_at DESC) WHERE status = 'active';

CREATE TRIGGER update_listings_updated_at
  BEFORE UPDATE ON listings FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active listings are publicly readable"
  ON listings FOR SELECT USING (status = 'active' OR seller_id = auth.uid());

CREATE POLICY "Sellers can insert own listings"
  ON listings FOR INSERT
  WITH CHECK (seller_id = auth.uid());

CREATE POLICY "Sellers can update own listings"
  ON listings FOR UPDATE
  USING (seller_id = auth.uid())
  WITH CHECK (seller_id = auth.uid());

CREATE POLICY "Sellers can delete own listings"
  ON listings FOR DELETE
  USING (seller_id = auth.uid());

GRANT SELECT ON listings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON listings TO authenticated;

-- ============================================
-- CART ITEMS: Shopping cart (persisted in DB)
-- ============================================
CREATE TABLE cart_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, listing_id)
);

CREATE INDEX idx_cart_items_user ON cart_items(user_id);

ALTER TABLE cart_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own cart"
  ON cart_items FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON cart_items TO authenticated;

-- ============================================
-- ORDERS: Purchase records (one per seller)
-- ============================================
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id UUID NOT NULL REFERENCES profiles(id),
  seller_id UUID NOT NULL REFERENCES profiles(id),
  status order_status NOT NULL DEFAULT 'pending_payment',
  subtotal NUMERIC(10,2) NOT NULL,
  shipping_cost NUMERIC(10,2) DEFAULT 0,
  platform_fee NUMERIC(10,2) DEFAULT 0,
  total NUMERIC(10,2) NOT NULL,
  stripe_payment_intent_id TEXT,
  stripe_transfer_id TEXT,
  shipping_address JSONB,
  tracking_number TEXT,
  tracking_carrier TEXT,
  buyer_notes TEXT,
  seller_notes TEXT,
  paid_at TIMESTAMPTZ,
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_orders_buyer ON orders(buyer_id);
CREATE INDEX idx_orders_seller ON orders(seller_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_stripe ON orders(stripe_payment_intent_id);

CREATE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON orders FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can see own orders"
  ON orders FOR SELECT
  USING (buyer_id = auth.uid() OR seller_id = auth.uid());

CREATE POLICY "Authenticated users can create orders"
  ON orders FOR INSERT
  WITH CHECK (buyer_id = auth.uid());

CREATE POLICY "Participants can update orders"
  ON orders FOR UPDATE
  USING (buyer_id = auth.uid() OR seller_id = auth.uid());

GRANT SELECT, INSERT, UPDATE ON orders TO authenticated;

-- ============================================
-- ORDER ITEMS: Line items within an order
-- ============================================
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES listings(id),
  card_id TEXT NOT NULL,
  card_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC(10,2) NOT NULL,
  condition card_condition NOT NULL,
  snapshot_photo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_listing ON order_items(listing_id);

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can see own order items"
  ON order_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = order_items.order_id
      AND (orders.buyer_id = auth.uid() OR orders.seller_id = auth.uid())
    )
  );

CREATE POLICY "System can insert order items"
  ON order_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = order_items.order_id
      AND orders.buyer_id = auth.uid()
    )
  );

GRANT SELECT, INSERT ON order_items TO authenticated;

-- ============================================
-- REVIEWS: Buyer reviews of sellers
-- ============================================
CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) UNIQUE,
  reviewer_id UUID NOT NULL REFERENCES profiles(id),
  seller_id UUID NOT NULL REFERENCES profiles(id),
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reviews_seller ON reviews(seller_id);
CREATE INDEX idx_reviews_reviewer ON reviews(reviewer_id);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Reviews are publicly readable"
  ON reviews FOR SELECT USING (true);

CREATE POLICY "Buyers can create reviews for delivered orders"
  ON reviews FOR INSERT
  WITH CHECK (
    reviewer_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = reviews.order_id
      AND orders.buyer_id = auth.uid()
      AND orders.status = 'delivered'
    )
  );

CREATE POLICY "Reviewers can update own reviews"
  ON reviews FOR UPDATE
  USING (reviewer_id = auth.uid());

GRANT SELECT ON reviews TO anon;
GRANT SELECT, INSERT, UPDATE ON reviews TO authenticated;

-- Trigger to auto-update seller rating
CREATE OR REPLACE FUNCTION update_seller_rating()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE profiles
  SET
    rating_avg = (SELECT AVG(rating)::NUMERIC(3,2) FROM reviews WHERE seller_id = NEW.seller_id),
    rating_count = (SELECT COUNT(*) FROM reviews WHERE seller_id = NEW.seller_id)
  WHERE id = NEW.seller_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_review_change
  AFTER INSERT OR UPDATE ON reviews
  FOR EACH ROW
  EXECUTE FUNCTION update_seller_rating();
