-- Recategorize intake_issues.issue_type into 4 fault-source buckets:
--   courier_damage | seller_packaging | internal_handling | missing_item
-- Replaces the older granular taxonomy (wrong_card, wrong_condition,
-- counterfeit, damaged_in_transit, wrong_quantity, other). Existing rows are
-- mapped: transit damage -> courier_damage, missing stays, everything else
-- -> internal_handling (so the new CHECK validates against current data).

alter table intake_issues drop constraint if exists intake_issues_issue_type_check;

update intake_issues
set issue_type = case
  when issue_type = 'damaged_in_transit' then 'courier_damage'
  when issue_type = 'missing_item'       then 'missing_item'
  else 'internal_handling'
end
where issue_type not in (
  'courier_damage', 'seller_packaging', 'internal_handling', 'missing_item'
);

alter table intake_issues
  add constraint intake_issues_issue_type_check
  check (issue_type in (
    'courier_damage', 'seller_packaging', 'internal_handling', 'missing_item'
  ));
