-- Let collectors override the current value of a holding. Useful when market
-- data is thin/unreliable (e.g. BGS Black Label, which rarely sells) — the
-- owner can set their own per-card value used in portfolio totals + gain/loss.
alter table collections
  add column if not exists custom_value numeric(12,2);
