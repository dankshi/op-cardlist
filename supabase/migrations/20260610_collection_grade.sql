-- Let a collection line carry a grade (PSA 10, BGS 9.5, …), not just raw
-- condition. A raw NM, a PSA 10, and a PSA 9 of the same card are now three
-- distinct lines.

alter table collections
  add column if not exists grading_company text,
  add column if not exists grade text;

-- Replace the old UNIQUE(user_id, card_id, condition) with one that also keys
-- on grade. NULLS NOT DISTINCT (PG15+) makes NULL grade/condition compare
-- equal, so two raw lines can't duplicate — and avoids the non-IMMUTABLE
-- enum::text cast that an expression index would require.
alter table collections drop constraint if exists collections_user_id_card_id_condition_key;
create unique index if not exists collections_user_card_variant_key
  on collections (user_id, card_id, condition, grading_company, grade) nulls not distinct;

-- Recreate the increment helper with grade params. Match an existing line
-- null-safely on (card, condition, company, grade); insert otherwise. Cost
-- basis is still preserved on conflict. Drop the old signature first.
drop function if exists upsert_collection_increment(text, card_condition, integer, numeric, date, text, uuid);

create or replace function upsert_collection_increment(
  p_card_id text,
  p_condition card_condition,
  p_quantity integer,
  p_acquired_price numeric default null,
  p_acquired_date date default null,
  p_acquired_via text default 'manual',
  p_order_id uuid default null,
  p_grading_company text default null,
  p_grade text default null
) returns collections
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row collections;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  update collections
  set quantity       = quantity + p_quantity,
      acquired_price = coalesce(acquired_price, p_acquired_price),
      acquired_date  = coalesce(acquired_date, p_acquired_date),
      updated_at     = now()
  where user_id = v_user
    and card_id = p_card_id
    and condition is not distinct from p_condition
    and grading_company is not distinct from p_grading_company
    and grade is not distinct from p_grade
  returning * into v_row;

  if not found then
    insert into collections (
      user_id, card_id, condition, quantity,
      acquired_price, acquired_date, acquired_via, order_id,
      grading_company, grade
    )
    values (
      v_user, p_card_id, p_condition, p_quantity,
      p_acquired_price, p_acquired_date, p_acquired_via, p_order_id,
      p_grading_company, p_grade
    )
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

grant execute on function upsert_collection_increment(
  text, card_condition, integer, numeric, date, text, uuid, text, text
) to authenticated;
