-- Fix RLS policies for card_mappings

-- Drop existing policies
DROP POLICY IF EXISTS "Anyone can read approved mappings" ON card_mappings;
DROP POLICY IF EXISTS "Anyone can submit mappings" ON card_mappings;
DROP POLICY IF EXISTS "Service role can update all" ON card_mappings;

-- Create simpler policies
-- Allow anyone to read all mappings (we filter in the API)
CREATE POLICY "Allow read all"
  ON card_mappings FOR SELECT
  USING (true);

-- Allow anyone to insert
CREATE POLICY "Allow insert"
  ON card_mappings FOR INSERT
  WITH CHECK (true);

-- Allow anyone to update (we protect with admin key in API)
CREATE POLICY "Allow update"
  ON card_mappings FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Grant permissions to anon and authenticated roles
GRANT SELECT, INSERT, UPDATE ON card_mappings TO anon;
GRANT SELECT, INSERT, UPDATE ON card_mappings TO authenticated;
