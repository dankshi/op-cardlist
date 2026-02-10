-- All TCGPlayer set names discovered for One Piece Card Game
-- Populated by scripts/discover-tcg-sets.ts

CREATE TABLE IF NOT EXISTS tcgplayer_sets (
  set_name TEXT PRIMARY KEY,              -- URL slug e.g. "romance-dawn"
  display_name TEXT,                      -- Human-readable e.g. "Romance Dawn"
  product_count INTEGER DEFAULT 0,        -- Number of card products in this set
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE tcgplayer_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read tcgplayer_sets"
  ON tcgplayer_sets FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert tcgplayer_sets"
  ON tcgplayer_sets FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update tcgplayer_sets"
  ON tcgplayer_sets FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Grants
GRANT SELECT, INSERT, UPDATE ON tcgplayer_sets TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON tcgplayer_sets TO authenticated;
