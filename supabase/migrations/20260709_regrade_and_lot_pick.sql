-- Two grading refinements (see docs/collection-pnl.md):
--   1. Pick WHICH acquisition becomes a slab (regrade_one_copy gains p_lot_id);
--      defaults to oldest-first when null.
--   2. Re-grade an existing slab (crossover / bump on resubmit) as a NEW logged
--      event that changes the grade in place and capitalizes the re-grade cost.

-- 1. regrade_one_copy += p_lot_id (specific source lot, else oldest).
drop function if exists regrade_one_copy(uuid, text, text, text, numeric, numeric, jsonb, uuid);

create or replace function regrade_one_copy(
  p_collection_id uuid,
  p_grading_company text,
  p_grade text,
  p_cert_number text default null,
  p_grading_cost numeric default 0,
  p_shipping_cost numeric default 0,
  p_subgrades jsonb default null,
  p_submission_id uuid default null,
  p_lot_id uuid default null
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

  if p_lot_id is not null then
    select * into v_lot from collection_lots where id = p_lot_id and collection_id = p_collection_id;
    if not found then raise exception 'chosen acquisition not found / already used up'; end if;
  else
    select * into v_lot from collection_lots
    where collection_id = p_collection_id
    order by acquired_date asc nulls last, created_at asc
    limit 1;
    if not found then raise exception 'no copies left to grade'; end if;
  end if;

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

grant execute on function regrade_one_copy(uuid, text, text, text, numeric, numeric, jsonb, uuid, uuid) to authenticated;

-- 2. Re-grade an existing slab IN PLACE, logging a new grade event old → new and
-- capitalizing the re-grade cost onto its lot. For crossovers / bump resubmits.
create or replace function regrade_existing_slab(
  p_collection_id uuid,
  p_grading_company text,
  p_grade text,
  p_cert_number text default null,
  p_subgrades jsonb default null,
  p_grading_cost numeric default 0,
  p_shipping_cost numeric default 0,
  p_submission_id uuid default null
) returns collections
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_src  collections;
  v_lot  collection_lots;
  v_fee  numeric := coalesce(p_grading_cost, 0) + coalesce(p_shipping_cost, 0);
  v_from text;
  v_row  collections;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select * into v_src from collections where id = p_collection_id and user_id = v_user;
  if not found then raise exception 'not your slab'; end if;
  if v_src.grading_company is null then raise exception 'not a graded slab'; end if;
  v_from := v_src.grading_company || ' ' || v_src.grade;

  update collections
     set grading_company = p_grading_company,
         grade           = p_grade,
         cert_number     = nullif(trim(coalesce(p_cert_number, '')), ''),
         subgrades       = p_subgrades,
         updated_at      = now()
   where id = p_collection_id;

  if v_fee > 0 then
    select * into v_lot from collection_lots where collection_id = p_collection_id
      order by acquired_date asc nulls last, created_at asc limit 1;
    if found then
      update collection_lots set grading_cost = coalesce(grading_cost, 0) + v_fee, updated_at = now() where id = v_lot.id;
    end if;
  end if;

  insert into collection_adjustments (user_id, card_id, collection_id, type, from_grade, to_grade, amount, shipping_cost, submission_id, happened_at, note)
  values (v_user, v_src.card_id, p_collection_id, 'grade', v_from, p_grading_company || ' ' || p_grade,
          v_fee, nullif(coalesce(p_shipping_cost, 0), 0), p_submission_id, now(), 'regrade');

  select * into v_row from collections where id = p_collection_id;
  return v_row;
end;
$$;

grant execute on function regrade_existing_slab(uuid, text, text, text, jsonb, numeric, numeric, uuid) to authenticated;
