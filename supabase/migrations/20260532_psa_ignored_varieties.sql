-- Admin-configurable list of PSA Variety values to treat as "ignored"
-- on /admin/psa-pops. Specs whose variety matches an entry here are
-- moved to the low-priority "Ignored" section instead of the active
-- "Unmapped variants" worklist. Admin can toggle entries via the UI to
-- adjust what's worth pursuing without a code change.
--
-- Empty variety (base specs) is always treated as ignored — that's
-- hardcoded in the admin page and doesn't need a row here.

CREATE TABLE IF NOT EXISTS psa_ignored_varieties (
  variety     TEXT PRIMARY KEY,
  ignored_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ignored_by  TEXT
);

ALTER TABLE psa_ignored_varieties ENABLE ROW LEVEL SECURITY;

-- Read-only for the admin page (anon/authenticated). Writes go through
-- the service role from /api/admin/psa-pops/ignored-varieties.
CREATE POLICY "Anyone can read psa_ignored_varieties"
  ON psa_ignored_varieties FOR SELECT USING (true);

GRANT SELECT ON psa_ignored_varieties TO anon, authenticated;

-- Seed with the current hardcoded defaults so behaviour is unchanged
-- when the table is first deployed.
INSERT INTO psa_ignored_varieties (variety, ignored_by) VALUES
  ('Pre-Release', 'seed'),
  ('Pre-Release ', 'seed'),
  ('Errata', 'seed'),
  ('Demo Deck', 'seed'),
  ('Demo Deck-Errata', 'seed'),
  ('Box Topper', 'seed'),
  ('Box Topper-Errata', 'seed'),
  ('Sparkle Foil', 'seed'),
  ('Jolly Roger Foil', 'seed'),
  ('Holofoil', 'seed'),
  ('Release Event', 'seed'),
  ('1st Anniversary Tournament', 'seed'),
  ('1st Anniversary Tournament ', 'seed'),
  ('2nd Anniversary Tournament', 'seed'),
  ('2nd Anniversary Tournament ', 'seed'),
  ('3rd Anniversary Tournament', 'seed')
ON CONFLICT (variety) DO NOTHING;
