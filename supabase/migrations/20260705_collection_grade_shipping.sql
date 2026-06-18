-- Grading-play shipping cost (see docs/collection-pnl.md).
--
-- A "grade play" (raw → graded) has two capitalizable costs: the grading fee
-- and shipping (to/from the grader). The lot's grading_cost column already folds
-- "extra cost beyond purchase price" into basis, so shipping rides in the same
-- slot — NO change to the basis math (sync_collection_from_lots /
-- close_collection_lots already include grading_cost). We only need to:
--   1. record the shipping portion on the grade adjustment for a clean
--      transaction breakdown, and
--   2. let the regrade RPC accept + capitalize it.

-- Breakdown column on the logged grade event. `amount` becomes the TOTAL
-- capitalized cost of the play (grading + shipping); shipping_cost is the
-- shipping slice of it (null on pre-existing rows / non-grade adjustments).
alter table collection_adjustments add column if not exists shipping_cost numeric;

-- Replace the regrade RPC with a 5-arg version (added p_shipping_cost). DROP
-- first: a new default param would otherwise create an ambiguous overload with
-- the old 4-arg signature.
drop function if exists regrade_collection_lot(uuid, text, text, numeric);

create or replace function regrade_collection_lot(
  p_lot_id uuid,
  p_grading_company text,
  p_grade text,
  p_grading_cost numeric default 0,
  p_shipping_cost numeric default 0
) returns collections
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user      uuid := auth.uid();
  v_lot       collection_lots;
  v_src       collections;
  v_target_id uuid;
  v_row       collections;
  v_fee       numeric := coalesce(p_grading_cost, 0) + coalesce(p_shipping_cost, 0);
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  select * into v_lot from collection_lots where id = p_lot_id;
  if not found then raise exception 'lot not found'; end if;
  select * into v_src from collections where id = v_lot.collection_id and user_id = v_user;
  if not found then raise exception 'not your lot'; end if;

  -- Find or create the target (graded) line for the same card.
  select id into v_target_id
  from collections
  where user_id = v_user and card_id = v_src.card_id
    and condition is not distinct from null
    and grading_company is not distinct from p_grading_company
    and grade is not distinct from p_grade;

  if v_target_id is null then
    insert into collections (user_id, card_id, condition, quantity, acquired_via, grading_company, grade)
    values (v_user, v_src.card_id, null, 0, v_src.acquired_via, p_grading_company, p_grade)
    returning id into v_target_id;
  end if;

  -- Move the copies: new lot under the target line carrying the original price
  -- plus the capitalized grading + shipping fee. Deletes the source lot (its
  -- line's aggregate re-syncs via trigger).
  insert into collection_lots (collection_id, quantity, price_paid, acquired_date, grading_cost)
  values (v_target_id, v_lot.quantity, v_lot.price_paid, v_lot.acquired_date,
          coalesce(v_lot.grading_cost, 0) + v_fee);

  delete from collection_lots where id = p_lot_id;

  insert into collection_adjustments (user_id, card_id, collection_id, type, from_grade, to_grade, amount, shipping_cost, happened_at, note)
  values (v_user, v_src.card_id, v_target_id, 'grade',
          case when v_src.grading_company is not null then v_src.grading_company || ' ' || v_src.grade else 'Raw' end,
          p_grading_company || ' ' || p_grade,
          v_fee, nullif(coalesce(p_shipping_cost, 0), 0), now(), null);

  select * into v_row from collections where id = v_target_id;
  return v_row;
end;
$$;

grant execute on function regrade_collection_lot(uuid, text, text, numeric, numeric) to authenticated;

-- Expose shipping_cost on the unified feed (appended at the end so CREATE OR
-- REPLACE VIEW accepts it). null for buy/sell.
create or replace view collection_activity
with (security_invoker = true)
as
  select
    c.user_id, c.card_id, l.collection_id,
    'buy'::text                                   as kind,
    coalesce(l.acquired_date::timestamptz, l.created_at) as happened_at,
    l.quantity,
    l.price_paid                                  as amount,
    (coalesce(l.price_paid, 0) * l.quantity + coalesce(l.grading_cost, 0)) as basis,
    null::numeric                                 as realized,
    null::uuid                                    as ref_order_id,
    null::uuid                                    as ref_listing_id,
    null::text                                    as from_grade,
    c.grading_company || ' ' || c.grade           as to_grade,
    null::text                                    as note,
    l.id                                          as source_id,
    null::numeric                                 as shipping_cost
  from collection_lots l
  join collections c on c.id = l.collection_id

  union all

  select
    s.user_id, s.card_id, s.collection_id,
    'sell'::text                                  as kind,
    s.sold_at                                     as happened_at,
    s.quantity,
    s.net_proceeds                                as amount,
    s.cost_basis                                  as basis,
    s.realized_gain                               as realized,
    s.order_id                                    as ref_order_id,
    s.listing_id                                  as ref_listing_id,
    null::text                                    as from_grade,
    nullif(trim(coalesce(s.grading_company, '') || ' ' || coalesce(s.grade, '')), '') as to_grade,
    s.note,
    s.id                                          as source_id,
    null::numeric                                 as shipping_cost
  from collection_sales s

  union all

  select
    a.user_id, a.card_id, a.collection_id,
    a.type                                        as kind,
    a.happened_at,
    null::integer                                 as quantity,
    a.amount,
    null::numeric                                 as basis,
    null::numeric                                 as realized,
    null::uuid                                    as ref_order_id,
    null::uuid                                    as ref_listing_id,
    a.from_grade,
    a.to_grade,
    a.note,
    a.id                                          as source_id,
    a.shipping_cost
  from collection_adjustments a;

grant select on collection_activity to authenticated;
