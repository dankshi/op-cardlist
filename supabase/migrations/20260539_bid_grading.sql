-- Offers can target a specific graded variant of a card.
--
-- Before: every bid was implicitly raw NM (condition_min defaulted to
-- 'near_mint'; the API hardcoded it). Buyers couldn't say "I'll pay $X
-- for a BGS 10 of this card" — only "I'll pay $X for a raw copy."
--
-- After: bids carry an optional (grading_company, grade) pair.
--   - Both NULL → bid is for the RAW NM variant (existing behavior;
--     all pre-migration rows backfill to this implicitly).
--   - Both SET → bid is for that specific slab (e.g. PSA 10).
--   - One set and the other NULL → invalid (CHECK rejects).
--
-- The fields mirror listings.grading_company / listings.grade so a
-- seller-side match between an offer and a listing is a straightforward
-- equality on (card_id, grading_company, grade).

ALTER TABLE bids
  ADD COLUMN IF NOT EXISTS grading_company TEXT
    CHECK (grading_company IS NULL OR grading_company IN ('PSA', 'CGC', 'BGS', 'TAG')),
  ADD COLUMN IF NOT EXISTS grade TEXT;

-- Pair-NULL or pair-set; mixing is invalid.
ALTER TABLE bids
  ADD CONSTRAINT bids_grading_pair_consistent
    CHECK (
      (grading_company IS NULL AND grade IS NULL) OR
      (grading_company IS NOT NULL AND grade IS NOT NULL)
    );

-- Indexed lookup for "find me all offers on PSA 10 of card X" — used by
-- the offers panel on the card detail page and (later) by the seller's
-- match-an-offer flow when listing a graded card.
CREATE INDEX IF NOT EXISTS idx_bids_card_variant
  ON bids (card_id, grading_company, grade)
  WHERE status = 'active';

COMMENT ON COLUMN bids.grading_company IS
  'Slab grader for graded bids. NULL means the bid is for a raw NM copy.';
COMMENT ON COLUMN bids.grade IS
  'Slab grade for graded bids (e.g. "10", "9.5", "Black Label 10"). NULL when grading_company is NULL.';
