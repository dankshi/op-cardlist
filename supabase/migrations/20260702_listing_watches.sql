-- Active-listing watch for rare TCGplayer products.
--
-- The rest of the price/sales pipeline is built on COMPLETED sales (the
-- mpapi `latestsales` feed → card_sales). That tells you what a card traded
-- for, but it fires AFTER someone else already bought it. For a rare chase
-- card you want the opposite: a ping the moment a *live listing* appears, so
-- you can be first to buy. That's a different TCGplayer endpoint
-- (mp-search-api `/product/{id}/listings`) and its own dedup state, hence
-- these two standalone tables — deliberately NOT joined to the cards catalog
-- or card_tcgplayer_mapping, because these promo cards (CS championship
-- packs) have no Bandai card_id at all.
--
--   listing_watches      — which products to poll, set by a human.
--   listing_watch_seen   — every listingId we've already alerted on, so the
--                          poller only Discord-pings genuinely NEW listings.
--                          MUST be persisted (GitHub Actions runners are
--                          ephemeral — in-memory dedup would re-alert the
--                          same listing every 5 minutes).

CREATE TABLE IF NOT EXISTS listing_watches (
  product_id    INTEGER PRIMARY KEY,          -- TCGplayer productId
  label         TEXT NOT NULL,                -- human name for the alert + admin
  tcgplayer_url TEXT,
  note          TEXT,                         -- why we're watching (e.g. "rare CS promo")
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS listing_watch_seen (
  listing_id    BIGINT PRIMARY KEY,           -- TCGplayer listingId
  product_id    INTEGER NOT NULL,
  price         NUMERIC,
  shipping_price NUMERIC,
  seller_name   TEXT,
  condition     TEXT,
  quantity      INTEGER,
  title         TEXT,                          -- seller's custom listing title
  alerted       BOOLEAN NOT NULL DEFAULT TRUE, -- false when seeded silently (--seed)
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- "Newest unseen listings for a product" + "what's still live" both filter by
-- product, so index it.
CREATE INDEX IF NOT EXISTS idx_listing_watch_seen_product
  ON listing_watch_seen (product_id);

ALTER TABLE listing_watches ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_watch_seen ENABLE ROW LEVEL SECURITY;

-- Read-only to anon/authenticated; all writes go through the poller's
-- service-role client (same pattern as scraper_runs).
CREATE POLICY "Anyone can read listing_watches"
  ON listing_watches FOR SELECT USING (true);
CREATE POLICY "Anyone can read listing_watch_seen"
  ON listing_watch_seen FOR SELECT USING (true);

GRANT SELECT ON listing_watches, listing_watch_seen TO anon, authenticated;

-- Seed the two rare Monkey.D.Luffy CS 25/26 championship promos the operator
-- asked to watch. ON CONFLICT DO NOTHING so re-running the migration is safe.
INSERT INTO listing_watches (product_id, label, tcgplayer_url, note) VALUES
  (649673, 'Monkey.D.Luffy — CS 25/26 Top Player Pack',
   'https://www.tcgplayer.com/product/649673', 'rare CS championship promo'),
  (649657, 'Monkey.D.Luffy — CS 25/26 Finalist Card Set 1',
   'https://www.tcgplayer.com/product/649657', 'rare CS championship promo')
ON CONFLICT (product_id) DO NOTHING;
