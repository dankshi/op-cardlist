-- Per-slab grading (see docs/collection-pnl.md).
--
-- A graded card is an INDIVIDUAL slab: its own grade AND its own cert number.
-- The old model bucketed graded copies by (card, company, grade) with a
-- quantity and a single line-level cert — which can't represent "3 copies sent
-- to Beckett, came back as 9.5 / 9 / 10, three different certs."
--
-- Two changes:
--   1. cert_number joins the line-uniqueness, so two same-grade slabs with
--      different certs are distinct lines. Strictly MORE permissive than the
--      old 5-col index (every old row stays unique), so no data migration.
--   2. regrade_one_copy: split ONE copy off a raw line into its own qty-1 graded
--      line with a cert, capitalizing its share of the grading + shipping cost.
--      The API calls it once per copy, so each slab gets its own grade + cert +
--      logged grade transaction.

-- 1. cert_number in the line key. nulls-not-distinct keeps raw bucketing intact
-- (raw lines have null company/grade/cert, still merged by condition).
drop index if exists collections_user_card_variant_key;
create unique index if not exists collections_user_card_variant_key
  on collections (user_id, card_id, condition, grading_company, grade, cert_number) nulls not distinct;

-- 2. Grade a single copy of a raw line into its own slab line.
create or replace function regrade_one_copy(
  p_collection_id uuid,
  p_grading_company text,
  p_grade text,
  p_cert_number text default null,
  p_grading_cost numeric default 0,
  p_shipping_cost numeric default 0
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

  -- Take one copy from the oldest lot (carries that copy's price basis).
  select * into v_lot from collection_lots
  where collection_id = p_collection_id
  order by acquired_date asc nulls last, created_at asc
  limit 1;
  if not found then raise exception 'no copies left to grade'; end if;

  -- The individual graded slab line (qty 1, its own cert).
  insert into collections (user_id, card_id, condition, quantity, acquired_via, grading_company, grade, cert_number)
  values (v_user, v_src.card_id, null, 0, v_src.acquired_via, p_grading_company, p_grade,
          nullif(trim(coalesce(p_cert_number, '')), ''))
  returning id into v_target_id;

  -- Its lot: this copy's price + the capitalized grading + shipping share.
  insert into collection_lots (collection_id, quantity, price_paid, acquired_date, grading_cost)
  values (v_target_id, 1, v_lot.price_paid, v_lot.acquired_date, v_fee);

  -- Remove the copy from the source lot (delete the lot when it empties). Raw
  -- lots carry no grading_cost, so nothing to re-proportion.
  if v_lot.quantity <= 1 then
    delete from collection_lots where id = v_lot.id;
  else
    update collection_lots set quantity = quantity - 1, updated_at = now() where id = v_lot.id;
  end if;

  insert into collection_adjustments (user_id, card_id, collection_id, type, from_grade, to_grade, amount, shipping_cost, happened_at, note)
  values (v_user, v_src.card_id, v_target_id, 'grade',
          case when v_src.grading_company is not null then v_src.grading_company || ' ' || v_src.grade else 'Raw' end,
          p_grading_company || ' ' || p_grade,
          v_fee, nullif(coalesce(p_shipping_cost, 0), 0), now(), null);

  select * into v_row from collections where id = v_target_id;
  return v_row;
end;
$$;

grant execute on function regrade_one_copy(uuid, text, text, text, numeric, numeric) to authenticated;
