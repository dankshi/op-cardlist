-- Collection P&L, Phase 1: dispositions + realized gain (see docs/collection-pnl.md).
--
-- A sale CLOSES collection lots. When a card a user listed sells through Nomi,
-- the order-status route records a `collection_sales` row: proceeds, fees, and
-- the cost basis of the lots it closed → a realized gain. Listings made from the
-- collection carry `collection_id` so we know exactly which line to close
-- (specific-line identification; collectibles are distinct items).

-- Tie a listing back to the collection line it came from. NULL for listings made
-- outside the collection (sell wizard, bulk) — those sales record proceeds-only.
alter table listings
  add column if not exists collection_id uuid references collections(id) on delete set null;

create table if not exists collection_sales (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,  -- seller
  card_id         text not null,
  collection_id   uuid references collections(id) on delete set null,        -- line closed
  order_id        uuid references orders(id) on delete set null,             -- null = manual
  listing_id      uuid references listings(id) on delete set null,
  channel         text not null default 'nomi' check (channel in ('nomi', 'manual')),
  quantity        integer not null check (quantity <> 0),  -- negative = reversal
  gross_proceeds  numeric,
  fees            numeric not null default 0,
  net_proceeds    numeric,
  cost_basis      numeric,                                  -- basis of closed lots; null = unknown
  grading_company text,
  grade           text,
  sold_at         timestamptz not null,
  note            text,
  created_at      timestamptz not null default now(),
  -- Realized gain only when we know what was paid. Net of fees already, since
  -- net_proceeds is the post-fee payout.
  realized_gain   numeric generated always as (net_proceeds - cost_basis) stored
);

-- One auto-record per (order, listing) so re-running the status route can't
-- double-book. Manual sales have NULL order_id (not covered by this index).
create unique index if not exists collection_sales_order_listing_key
  on collection_sales (order_id, listing_id)
  where order_id is not null;

create index if not exists collection_sales_user_card_idx on collection_sales (user_id, card_id);

alter table collection_sales enable row level security;

drop policy if exists collection_sales_owner on collection_sales;
create policy collection_sales_owner on collection_sales
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Close `p_quantity` copies from a line's lots, oldest acquisition first, and
-- return the total cost basis of what was closed (NULL when no closed copy
-- carried a price). The sync trigger rolls the line's quantity down as lots
-- shrink/disappear. The (possibly emptied) line is left in place so
-- collection_sales.collection_id stays valid for history; readers hide
-- zero-quantity lines.
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
    select id, quantity, price_paid
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
    if v_take >= r.quantity then
      delete from collection_lots where id = r.id;
    else
      update collection_lots set quantity = quantity - v_take, updated_at = now() where id = r.id;
    end if;
    v_need := v_need - v_take;
  end loop;

  return case when v_priced then v_basis else null end;
end;
$$;

grant execute on function close_collection_lots(uuid, integer) to authenticated;
