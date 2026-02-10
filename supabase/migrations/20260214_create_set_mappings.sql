-- Mapping between our Bandai set IDs and TCGPlayer set names
-- One Bandai set can map to multiple TCGPlayer sets (main + pre-release + tournament)
-- Replaces the hardcoded SET_NAME_MAP in src/lib/set-names.ts

CREATE TABLE IF NOT EXISTS set_mappings (
  bandai_set_id TEXT NOT NULL,              -- Our set ID e.g. "op-13"
  tcgplayer_set_name TEXT NOT NULL          -- FK to tcgplayer_sets
    REFERENCES tcgplayer_sets(set_name),
  is_primary BOOLEAN DEFAULT FALSE,         -- True for main set (not pre-release/tournament)
  notes TEXT,                               -- Optional human notes
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (bandai_set_id, tcgplayer_set_name)
);

-- Index for the common lookup pattern
CREATE INDEX IF NOT EXISTS idx_set_mappings_bandai ON set_mappings(bandai_set_id);

-- Row Level Security
ALTER TABLE set_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read set_mappings"
  ON set_mappings FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert set_mappings"
  ON set_mappings FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update set_mappings"
  ON set_mappings FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Grants
GRANT SELECT, INSERT, UPDATE ON set_mappings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON set_mappings TO authenticated;
