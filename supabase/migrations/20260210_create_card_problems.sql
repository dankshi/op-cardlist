-- Create card_problems table for tracking reported issues
CREATE TABLE IF NOT EXISTS card_problems (
  id SERIAL PRIMARY KEY,
  card_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  reported_by TEXT DEFAULT 'anonymous',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster lookups by card_id
CREATE INDEX IF NOT EXISTS idx_card_problems_card_id ON card_problems(card_id);

-- Enable RLS
ALTER TABLE card_problems ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read problems
CREATE POLICY "Allow public read access to card_problems"
  ON card_problems FOR SELECT
  USING (true);

-- Allow anyone to insert problems (for reporting)
CREATE POLICY "Allow public insert access to card_problems"
  ON card_problems FOR INSERT
  WITH CHECK (true);

-- Allow anyone to delete problems (for dismissing)
CREATE POLICY "Allow public delete access to card_problems"
  ON card_problems FOR DELETE
  USING (true);
