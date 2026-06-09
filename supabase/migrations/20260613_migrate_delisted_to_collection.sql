-- Unify ownership on the collections table: bring existing parked (delisted)
-- listings into each seller's collection as normal entries, so /collection is
-- a single, simple source of truth (no more separate "parked" surface). Graded
-- lines store condition=null to match the manual-add convention. ON CONFLICT
-- DO NOTHING so re-runs and existing collection rows are left untouched. The
-- delisted listings themselves are left in place for Seller Hub.
insert into collections (user_id, card_id, condition, grading_company, grade, quantity, acquired_via)
select
  seller_id,
  card_id,
  case when grading_company is not null then null else condition end,
  grading_company,
  grade,
  quantity_available,
  'manual'
from listings
where status = 'delisted'
  and quantity_available > 0
on conflict do nothing;
