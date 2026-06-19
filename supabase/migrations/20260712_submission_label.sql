-- A human-entered submission identifier (the grader's order/submission number)
-- so users can organize their grading batches. Distinct from submission_id (the
-- internal uuid that groups a batch). Stored on every grade event in the batch.

alter table collection_adjustments add column if not exists submission_label text;

-- Expose it on the unified feed (appended; null for buy/sell).
create or replace view collection_activity
with (security_invoker = true)
as
  select c.user_id, c.card_id, l.collection_id, 'buy'::text as kind,
    coalesce(l.acquired_date::timestamptz, l.created_at) as happened_at,
    l.quantity, l.price_paid as amount,
    (coalesce(l.price_paid, 0) * l.quantity + coalesce(l.grading_cost, 0)) as basis,
    null::numeric as realized, null::uuid as ref_order_id, null::uuid as ref_listing_id,
    null::text as from_grade, c.grading_company || ' ' || c.grade as to_grade,
    null::text as note, l.id as source_id, null::numeric as shipping_cost,
    null::uuid as submission_id, null::text as submission_label
  from collection_lots l join collections c on c.id = l.collection_id
  union all
  select s.user_id, s.card_id, s.collection_id, 'sell'::text as kind,
    s.sold_at as happened_at, s.quantity, s.net_proceeds as amount, s.cost_basis as basis,
    s.realized_gain as realized, s.order_id as ref_order_id, s.listing_id as ref_listing_id,
    null::text as from_grade,
    nullif(trim(coalesce(s.grading_company, '') || ' ' || coalesce(s.grade, '')), '') as to_grade,
    s.note, s.id as source_id, null::numeric as shipping_cost,
    null::uuid as submission_id, null::text as submission_label
  from collection_sales s
  union all
  select a.user_id, a.card_id, a.collection_id, a.type as kind, a.happened_at,
    null::integer as quantity, a.amount, null::numeric as basis, null::numeric as realized,
    null::uuid as ref_order_id, null::uuid as ref_listing_id, a.from_grade, a.to_grade,
    a.note, a.id as source_id, a.shipping_cost, a.submission_id, a.submission_label
  from collection_adjustments a;

grant select on collection_activity to authenticated;
