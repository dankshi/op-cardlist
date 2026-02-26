-- Allow delete for cleanup/maintenance operations

CREATE POLICY "Anyone can delete tcgplayer_sets"
  ON tcgplayer_sets FOR DELETE
  USING (true);

CREATE POLICY "Anyone can delete set_mappings"
  ON set_mappings FOR DELETE
  USING (true);

GRANT DELETE ON tcgplayer_sets TO anon;
GRANT DELETE ON set_mappings TO anon;
