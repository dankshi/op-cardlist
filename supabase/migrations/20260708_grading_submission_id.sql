-- Group graded copies into the submission they were sent in (see
-- docs/collection-pnl.md). Each copy is its own grade event + slab, but a
-- submission is a batch graded together (shared shipping). A submission_id on
-- the grade adjustment ties them so the grading log can group by submission.

alter table collection_adjustments add column if not exists submission_id uuid;
create index if not exists collection_adjustments_submission_idx on collection_adjustments (submission_id);

-- regrade_one_copy gains p_submission_id (the API passes one id per batch).
drop function if exists regrade_one_copy(uuid, text, text, text, numeric, numeric, jsonb);

create or replace function regrade_one_copy(
  p_collection_id uuid,
  p_grading_company text,
  p_grade text,
  p_cert_number text default null,
  p_grading_cost numeric default 0,
  p_shipping_cost numeric default 0,
  p_subgrades jsonb default null,
  p_submission_id uuid default null
) returns collections
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user      uuid := auth.uid();
  v_src       collections;
  v_lot       collection_lots;
  v_target_id uuid;
  v_row       collections;
  v_fee       numeric := coalesce(p_grading_cost, 0) + coalesce(p_shipping_cost, 0);
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  select * into v_src from collections where id = p_collection_id and user_id = v_user;
  if not found then raise exception 'not your line'; end if;

  select * into v_lot from collection_lots
  where collection_id = p_collection_id
  order by acquired_date asc nulls last, created_at asc
  limit 1;
  if not found then raise exception 'no copies left to grade'; end if;

  insert into collections (user_id, card_id, condition, quantity, acquired_via, grading_company, grade, cert_number, subgrades)
  values (v_user, v_src.card_id, null, 0, v_src.acquired_via, p_grading_company, p_grade,
          nullif(trim(coalesce(p_cert_number, '')), ''), p_subgrades)
  returning id into v_target_id;

  insert into collection_lots (collection_id, quantity, price_paid, acquired_date, grading_cost)
  values (v_target_id, 1, v_lot.price_paid, v_lot.acquired_date, v_fee);

  if v_lot.quantity <= 1 then
    delete from collection_lots where id = v_lot.id;
  else
    update collection_lots set quantity = quantity - 1, updated_at = now() where id = v_lot.id;
  end if;

  insert into collection_adjustments (user_id, card_id, collection_id, type, from_grade, to_grade, amount, shipping_cost, submission_id, happened_at, note)
  values (v_user, v_src.card_id, v_target_id, 'grade',
          case when v_src.grading_company is not null then v_src.grading_company || ' ' || v_src.grade else 'Raw' end,
          p_grading_company || ' ' || p_grade,
          v_fee, nullif(coalesce(p_shipping_cost, 0), 0), p_submission_id, now(), null);

  select * into v_row from collections where id = v_target_id;
  return v_row;
end;
$$;

grant execute on function regrade_one_copy(uuid, text, text, text, numeric, numeric, jsonb, uuid) to authenticated;

-- Expose submission_id on the unified feed (appended at end; null for buy/sell).
create or replace view collection_activity
with (security_invoker = true)
as
  select c.user_id, c.card_id, l.collection_id, 'buy'::text as kind,
    coalesce(l.acquired_date::timestamptz, l.created_at) as happened_at,
    l.quantity, l.price_paid as amount,
    (coalesce(l.price_paid, 0) * l.quantity + coalesce(l.grading_cost, 0)) as basis,
    null::numeric as realized, null::uuid as ref_order_id, null::uuid as ref_listing_id,
    null::text as from_grade, c.grading_company || ' ' || c.grade as to_grade,
    null::text as note, l.id as source_id, null::numeric as shipping_cost, null::uuid as submission_id
  from collection_lots l join collections c on c.id = l.collection_id
  union all
  select s.user_id, s.card_id, s.collection_id, 'sell'::text as kind,
    s.sold_at as happened_at, s.quantity, s.net_proceeds as amount, s.cost_basis as basis,
    s.realized_gain as realized, s.order_id as ref_order_id, s.listing_id as ref_listing_id,
    null::text as from_grade,
    nullif(trim(coalesce(s.grading_company, '') || ' ' || coalesce(s.grade, '')), '') as to_grade,
    s.note, s.id as source_id, null::numeric as shipping_cost, null::uuid as submission_id
  from collection_sales s
  union all
  select a.user_id, a.card_id, a.collection_id, a.type as kind, a.happened_at,
    null::integer as quantity, a.amount, null::numeric as basis, null::numeric as realized,
    null::uuid as ref_order_id, null::uuid as ref_listing_id, a.from_grade, a.to_grade,
    a.note, a.id as source_id, a.shipping_cost, a.submission_id
  from collection_adjustments a;

grant select on collection_activity to authenticated;
