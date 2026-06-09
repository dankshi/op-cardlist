-- Collection portfolio: provenance columns + an atomic increment helper.
--
-- The collection can be fed two ways now: manual adds and auto-adds when a
-- Nomi purchase is delivered. Both paths funnel through one function so the
-- UNIQUE(user_id, card_id, condition) line is incremented (not duplicated)
-- and the original cost basis is preserved.

alter table collections
  add column if not exists acquired_via text not null default 'manual'
    check (acquired_via in ('manual', 'purchase')),
  add column if not exists order_id uuid references orders(id) on delete set null;

-- Atomic "add to collection" — insert a new line or, if one already exists
-- for this (user, card, condition), bump its quantity. SECURITY INVOKER so
-- RLS applies and the row is always scoped to the calling user (auth.uid());
-- no user_id parameter means a caller can't write to someone else's
-- collection. condition is matched null-safely (IS NOT DISTINCT FROM) since
-- the unique constraint treats NULLs as distinct. Cost basis (acquired_price
-- / acquired_date) is only filled when previously missing, so a later
-- purchase never overwrites what the collector originally paid.
create or replace function upsert_collection_increment(
  p_card_id text,
  p_condition card_condition,
  p_quantity integer,
  p_acquired_price numeric default null,
  p_acquired_date date default null,
  p_acquired_via text default 'manual',
  p_order_id uuid default null
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
  returning * into v_row;

  if not found then
    insert into collections (
      user_id, card_id, condition, quantity,
      acquired_price, acquired_date, acquired_via, order_id
    )
    values (
      v_user, p_card_id, p_condition, p_quantity,
      p_acquired_price, p_acquired_date, p_acquired_via, p_order_id
    )
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

grant execute on function upsert_collection_increment(
  text, card_condition, integer, numeric, date, text, uuid
) to authenticated;
