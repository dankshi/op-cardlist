-- Bandai card catalog as proper DB tables. Mirrors data/cards.json which
-- is scraped from en.onepiece-cardgame.com. cards.json stays in git as a
-- diff-able snapshot; this DB copy is the queryable source-of-truth for
-- things like the PSA matcher (needs rarity), admin tools, and any
-- future SQL join against card metadata.

CREATE TABLE IF NOT EXISTS card_sets (
  id           TEXT PRIMARY KEY,            -- "op-01"
  name         TEXT NOT NULL,               -- "OP-01 - Romance Dawn"
  series_id    TEXT,                        -- Bandai's series ID e.g. "569101"
  release_date DATE,
  card_count   INTEGER,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cards (
  id           TEXT PRIMARY KEY,            -- "OP01-001" or "OP01-001_p1"
  base_id      TEXT NOT NULL,               -- "OP01-001" (parent for variants)
  set_id       TEXT NOT NULL REFERENCES card_sets(id),
  name         TEXT NOT NULL,
  type         TEXT NOT NULL,               -- LEADER / CHARACTER / EVENT / STAGE / DON
  colors       TEXT[] NOT NULL DEFAULT '{}',
  rarity       TEXT,                        -- L / C / U / R / SR / SEC / SP / P
  cost         INTEGER,
  power        INTEGER,
  counter      INTEGER,
  life         INTEGER,
  attribute    TEXT,
  traits       TEXT[] NOT NULL DEFAULT '{}',
  effect       TEXT,
  trigger_text TEXT,                        -- "trigger" is reserved in Postgres
  image_url    TEXT,
  variant      TEXT,                        -- "p1" / "p4" / "r1" etc, NULL for base
  is_parallel  BOOLEAN NOT NULL DEFAULT FALSE,
  art_style    TEXT,                        -- standard / alternate / manga / wanted
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cards_base_id ON cards (base_id);
CREATE INDEX IF NOT EXISTS cards_set_id  ON cards (set_id);
CREATE INDEX IF NOT EXISTS cards_rarity  ON cards (rarity);

ALTER TABLE card_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE cards     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read card_sets" ON card_sets FOR SELECT USING (true);
CREATE POLICY "Anyone can read cards"     ON cards     FOR SELECT USING (true);

GRANT SELECT ON card_sets TO anon, authenticated;
GRANT SELECT ON cards     TO anon, authenticated;
