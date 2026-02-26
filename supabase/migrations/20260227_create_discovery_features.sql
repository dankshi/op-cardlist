-- ============================================
-- COLLECTIONS: Track owned cards
-- ============================================
CREATE TABLE collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  condition card_condition,
  notes TEXT,
  acquired_price NUMERIC(10,2),
  acquired_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, card_id, condition)
);

CREATE INDEX idx_collections_user ON collections(user_id);
CREATE INDEX idx_collections_card ON collections(card_id);

ALTER TABLE collections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own collection"
  ON collections FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Collections are publicly readable"
  ON collections FOR SELECT USING (true);

GRANT SELECT ON collections TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON collections TO authenticated;

-- ============================================
-- WANT LISTS: Cards users want to buy
-- ============================================
CREATE TABLE want_list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  max_price NUMERIC(10,2),
  min_condition card_condition DEFAULT 'lightly_played',
  priority INTEGER DEFAULT 0,
  notes TEXT,
  notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, card_id)
);

CREATE INDEX idx_want_list_user ON want_list_items(user_id);
CREATE INDEX idx_want_list_card ON want_list_items(card_id);

ALTER TABLE want_list_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own want list"
  ON want_list_items FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON want_list_items TO authenticated;

-- ============================================
-- PRICE ALERTS: Notify on price changes
-- ============================================
CREATE TABLE price_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  target_price NUMERIC(10,2) NOT NULL,
  alert_type TEXT DEFAULT 'below',
  is_active BOOLEAN DEFAULT TRUE,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, card_id, alert_type)
);

CREATE INDEX idx_price_alerts_active ON price_alerts(card_id) WHERE is_active = TRUE;

ALTER TABLE price_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own alerts"
  ON price_alerts FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON price_alerts TO authenticated;

-- ============================================
-- DECKS: Deck building
-- ============================================
CREATE TABLE decks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  leader_card_id TEXT,
  is_public BOOLEAN DEFAULT FALSE,
  view_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_decks_user ON decks(user_id);
CREATE INDEX idx_decks_public ON decks(is_public) WHERE is_public = TRUE;

CREATE TABLE deck_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id UUID NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1 AND quantity <= 4),
  is_sideboard BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(deck_id, card_id, is_sideboard)
);

CREATE INDEX idx_deck_cards_deck ON deck_cards(deck_id);

ALTER TABLE decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE deck_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public decks are readable by all"
  ON decks FOR SELECT
  USING (is_public = TRUE OR user_id = auth.uid());

CREATE POLICY "Users can manage own decks"
  ON decks FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Deck cards follow deck visibility"
  ON deck_cards FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM decks
      WHERE decks.id = deck_cards.deck_id
      AND (decks.is_public = TRUE OR decks.user_id = auth.uid())
    )
  );

CREATE POLICY "Users can manage cards in own decks"
  ON deck_cards FOR ALL
  USING (
    EXISTS (SELECT 1 FROM decks WHERE decks.id = deck_cards.deck_id AND decks.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM decks WHERE decks.id = deck_cards.deck_id AND decks.user_id = auth.uid())
  );

GRANT SELECT ON decks TO anon;
GRANT SELECT ON deck_cards TO anon;
GRANT ALL ON decks TO authenticated;
GRANT ALL ON deck_cards TO authenticated;

-- ============================================
-- MESSAGES: Buyer-seller communication
-- ============================================
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id),
  sender_id UUID NOT NULL REFERENCES profiles(id),
  recipient_id UUID NOT NULL REFERENCES profiles(id),
  content TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_order ON messages(order_id);
CREATE INDEX idx_messages_recipient ON messages(recipient_id, read_at) WHERE read_at IS NULL;

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can see own messages"
  ON messages FOR SELECT
  USING (sender_id = auth.uid() OR recipient_id = auth.uid());

CREATE POLICY "Users can send messages"
  ON messages FOR INSERT
  WITH CHECK (sender_id = auth.uid());

CREATE POLICY "Recipients can mark messages read"
  ON messages FOR UPDATE
  USING (recipient_id = auth.uid());

GRANT SELECT, INSERT, UPDATE ON messages TO authenticated;
