-- Per-acquisition cost basis: collection_lots.
--
-- A collection line (a card+variant a user owns) can now be made up of several
-- "lots" — distinct purchases, each with its own quantity, price paid, and
-- acquired date. This lets a collector record buying the same card three times
-- at three different prices.
--
-- collection_lots is the source of truth for quantity + cost basis. A trigger
-- keeps the parent collections row's aggregate columns (quantity,
-- acquired_price, acquired_date) in sync so every existing reader — both
-- valuation pages, the value-series API, and the purchase auto-add path — keeps
-- working unchanged against the rolled-up line.

create table if not exists collection_lots (
  id            uuid primary key default gen_random_uuid(),
  collection_id uuid not null references collections(id) on delete cascade,
  quantity      integer not null check (quantity > 0),
  price_paid    numeric,
  acquired_date date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists collection_lots_collection_id_idx on collection_lots (collection_id);

-- Quantity is lot-derived now; default the line to 0 so the increment RPC can
-- insert a bare line and let the trigger fill the count from its lots.
alter table collections alter column quantity set default 0;

-- RLS: a lot is owned by whoever owns its parent collection line.
alter table collection_lots enable row level security;

drop policy if exists collection_lots_owner on collection_lots;
create policy collection_lots_owner on collection_lots
  for all
  using (exists (
    select 1 from collections c
    where c.id = collection_lots.collection_id and c.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from collections c
    where c.id = collection_lots.collection_id and c.user_id = auth.uid()
  ));

-- Recompute a line's aggregates from its lots. acquired_price is set so that
-- (acquired_price * quantity) equals the true total cost — i.e. total cost
-- spread across every copy, NULL only when no lot carries a price. SECURITY
-- DEFINER so it can update the parent line regardless of the row that fired it
-- (the lot write was already RLS-authorized).
create or replace function sync_collection_from_lots() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_collection_id uuid := coalesce(new.collection_id, old.collection_id);
  v_qty        integer;
  v_total_cost numeric;
  v_priced_qty integer;
  v_date       date;
begin
  select coalesce(sum(quantity), 0),
         coalesce(sum(case when price_paid is not null then price_paid * quantity else 0 end), 0),
         coalesce(sum(case when price_paid is not null then quantity else 0 end), 0),
         max(acquired_date)
    into v_qty, v_total_cost, v_priced_qty, v_date
  from collection_lots
  where collection_id = v_collection_id;

  update collections
     set quantity       = v_qty,
         acquired_price = case when v_priced_qty > 0 then round(v_total_cost / nullif(v_qty, 0), 2) else null end,
         acquired_date  = v_date,
         updated_at     = now()
   where id = v_collection_id;

  return null;
end;
$$;

drop trigger if exists trg_sync_collection_from_lots on collection_lots;
create trigger trg_sync_collection_from_lots
after insert or update or delete on collection_lots
for each row execute function sync_collection_from_lots();

-- Backfill: every current line becomes a single lot mirroring its existing
-- quantity / cost basis. (The trigger then recomputes the line to the same
-- values, so this is a no-op on the aggregates.)
insert into collection_lots (collection_id, quantity, price_paid, acquired_date)
select id, quantity, acquired_price, acquired_date
from collections
where quantity > 0
  and not exists (select 1 from collection_lots l where l.collection_id = collections.id);

-- Rewrite the increment helper to create lots instead of bumping the line
-- directly. Signature + return type are unchanged so both callers (manual add
-- in /api/collection, purchase auto-add in confirm-delivery) keep working.
-- Rule: an unpriced add (no price) merges into the line's existing unpriced lot
-- so repeated quick-adds stay one tidy "loose" pile; a priced add is its own
-- lot so distinct purchases keep distinct cost bases.
drop function if exists upsert_collection_increment(text, card_condition, integer, numeric, date, text, uuid, text, text);

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
  v_user    uuid := auth.uid();
  v_line_id uuid;
  v_lot_id  uuid;
  v_row     collections;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  -- Find or create the variant line (quantity is lot-derived; start at 0).
  select id into v_line_id
  from collections
  where user_id = v_user
    and card_id = p_card_id
    and condition is not distinct from p_condition
    and grading_company is not distinct from p_grading_company
    and grade is not distinct from p_grade;

  if v_line_id is null then
    insert into collections (
      user_id, card_id, condition, quantity, acquired_via, order_id, grading_company, grade
    )
    values (
      v_user, p_card_id, p_condition, 0, p_acquired_via, p_order_id, p_grading_company, p_grade
    )
    returning id into v_line_id;
  end if;

  -- Unpriced add merges into the line's existing unpriced lot, if any.
  if p_acquired_price is null then
    update collection_lots
       set quantity = quantity + p_quantity, updated_at = now()
     where collection_id = v_line_id and price_paid is null
     returning id into v_lot_id;
  end if;

  -- Otherwise (priced add, or no unpriced lot to merge into) start a new lot.
  if v_lot_id is null then
    insert into collection_lots (collection_id, quantity, price_paid, acquired_date)
    values (v_line_id, p_quantity, p_acquired_price, p_acquired_date);
  end if;

  select * into v_row from collections where id = v_line_id;
  return v_row;
end;
$$;

grant execute on function upsert_collection_increment(
  text, card_condition, integer, numeric, date, text, uuid, text, text
) to authenticated;
