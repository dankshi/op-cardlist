-- Collection P&L, Phase 2 (see docs/collection-pnl.md):
--   * grading cost capitalized into a lot's basis
--   * collection_adjustments — a logged ledger for grade changes / basis tweaks
--   * collection_activity — a unified buy/sell/grade feed (one query for the
--     per-card history view and the global ledger)
--   * regrade RPC — move a lot to a new grade as a first-class, logged event

-- Grading cost lives on the lot and folds into the line's basis.
alter table collection_lots
  add column if not exists grading_cost numeric not null default 0;

-- Recompute the line aggregate INCLUDING grading cost. Total cost (priced
-- copies + grading) is spread across every copy so readers' (acquired_price *
-- quantity) still equals the exact total basis. acquired_price is NULL only
-- when nothing carries a cost.
create or replace function sync_collection_from_lots() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_collection_id uuid := coalesce(new.collection_id, old.collection_id);
  v_qty        integer;
  v_total_cost numeric;
  v_has_cost   boolean;
  v_date       date;
begin
  select coalesce(sum(quantity), 0),
         coalesce(sum(coalesce(price_paid, 0) * quantity + coalesce(grading_cost, 0)), 0),
         bool_or(price_paid is not null or grading_cost > 0),
         max(acquired_date)
    into v_qty, v_total_cost, v_has_cost, v_date
  from collection_lots
  where collection_id = v_collection_id;

  update collections
     set quantity       = v_qty,
         acquired_price = case when coalesce(v_has_cost, false) then round(v_total_cost / nullif(v_qty, 0), 2) else null end,
         acquired_date  = v_date,
         updated_at     = now()
   where id = v_collection_id;

  return null;
end;
$$;

-- Close lots oldest-first, returning basis of what closed — now including a
-- proportional share of each lot's grading cost.
create or replace function close_collection_lots(p_collection_id uuid, p_quantity integer)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_need   integer := p_quantity;
  v_take   integer;
  v_basis  numeric := 0;
  v_priced boolean := false;
  r        record;
begin
  for r in
    select id, quantity, price_paid, grading_cost
    from collection_lots
    where collection_id = p_collection_id
    order by acquired_date asc nulls last, created_at asc
  loop
    exit when v_need <= 0;
    v_take := least(r.quantity, v_need);
    if r.price_paid is not null then
      v_basis  := v_basis + r.price_paid * v_take;
      v_priced := true;
    end if;
    if coalesce(r.grading_cost, 0) > 0 then
      v_basis  := v_basis + r.grading_cost * v_take / r.quantity;
      v_priced := true;
    end if;
    if v_take >= r.quantity then
      delete from collection_lots where id = r.id;
    else
      update collection_lots set quantity = quantity - v_take, updated_at = now() where id = r.id;
    end if;
    v_need := v_need - v_take;
  end loop;

  return case when v_priced then round(v_basis, 2) else null end;
end;
$$;

-- Logged adjustments: grade changes, basis tweaks, notes.
create table if not exists collection_adjustments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  card_id       text not null,
  collection_id uuid references collections(id) on delete set null,
  type          text not null check (type in ('grade', 'basis', 'note')),
  from_grade    text,
  to_grade      text,
  amount        numeric,            -- grading fee / basis delta
  happened_at   timestamptz not null,
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists collection_adjustments_user_card_idx on collection_adjustments (user_id, card_id);

alter table collection_adjustments enable row level security;
drop policy if exists collection_adjustments_owner on collection_adjustments;
create policy collection_adjustments_owner on collection_adjustments
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Regrade a lot: capitalize the grading fee, move the copies to the target
-- grade's line (creating it if needed), and log a 'grade' adjustment. Returns
-- the target collection line. SECURITY INVOKER so RLS scopes every write to the
-- caller's own rows.
create or replace function regrade_collection_lot(
  p_lot_id uuid,
  p_grading_company text,
  p_grade text,
  p_grading_cost numeric default 0
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

  -- Move the copies: new lot under the target line carrying the original
  -- price plus the capitalized grading fee. Deletes the source lot (its line's
  -- aggregate re-syncs via trigger).
  insert into collection_lots (collection_id, quantity, price_paid, acquired_date, grading_cost)
  values (v_target_id, v_lot.quantity, v_lot.price_paid, v_lot.acquired_date,
          coalesce(v_lot.grading_cost, 0) + coalesce(p_grading_cost, 0));

  delete from collection_lots where id = p_lot_id;

  insert into collection_adjustments (user_id, card_id, collection_id, type, from_grade, to_grade, amount, happened_at, note)
  values (v_user, v_src.card_id, v_target_id, 'grade',
          case when v_src.grading_company is not null then v_src.grading_company || ' ' || v_src.grade else 'Raw' end,
          p_grading_company || ' ' || p_grade,
          p_grading_cost, now(), null);

  select * into v_row from collections where id = v_target_id;
  return v_row;
end;
$$;

grant execute on function regrade_collection_lot(uuid, text, text, numeric) to authenticated;

-- Unified activity feed: buys (lots) + sells (sales) + grade/basis events.
-- security_invoker so the underlying tables' RLS scopes rows to the caller.
create or replace view collection_activity
with (security_invoker = true)
as
  select
    c.user_id,
    c.card_id,
    l.collection_id,
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
    l.id                                          as source_id
  from collection_lots l
  join collections c on c.id = l.collection_id

  union all

  select
    s.user_id,
    s.card_id,
    s.collection_id,
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
    s.id                                          as source_id
  from collection_sales s

  union all

  select
    a.user_id,
    a.card_id,
    a.collection_id,
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
    a.id                                          as source_id
  from collection_adjustments a;

grant select on collection_activity to authenticated;
