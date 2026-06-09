# Collection P&L — tracking a card like a stock

Turn the collection into a brokerage-style portfolio: every card has a cost
basis (what you paid), a current value (market), and — once you sell — a
**realized** gain/loss. A per-card history feed and a global transactions
ledger show the whole story; an export gives you the tax-shaped numbers.

This builds directly on [collection lots](./collection-lots.md): a `collection_lots`
row is an open **tax lot** (an acquisition with its own quantity, price, date).
Selling **closes** lots. Because every card is a distinct physical item, we use
**specific-line identification** (you sold *that* line's cards), not FIFO
guessing across unrelated holdings — collectibles are cleaner than equities here.

## Vocabulary

- **Lot** — one acquisition (`collection_lots`). Open until sold.
- **Disposition / sale** — closing lots: a sale (Nomi or off-platform), with
  proceeds, fees, and the basis of what was closed → a **realized** gain.
- **Cost basis** — `Σ (price_paid·qty) + grading_cost` over the lots involved.
- **Realized P&L** — `Σ (net_proceeds − cost_basis)` over dispositions.
- **Unrealized P&L** — `Σ (market_value − cost_basis)` over open lots.
- **Total return** — realized + unrealized.

## Source of truth & the "stay clean" rules

Three operational tables hold **state**; the history feed and ledger are
**derived views** over them (no duplicated bookkeeping, no drift):

| table | role |
| --- | --- |
| `collection_lots` | acquisitions / open positions (+ `grading_cost`) |
| `collection_sales` | dispositions / closed positions |
| `collection_adjustments` | grade changes & basis tweaks (Phase 2) |

Cleanliness invariants:

1. **Specific-line identification.** A listing binds to the collection line it
   came from (`listings.collection_id`); selling closes that line's lots. Exact
   realized math, no cross-holding ambiguity.
2. **Append-only history.** `collection_sales` / `collection_adjustments` rows
   are never mutated to "fix" the past — a correction (refund, re-grade) is a
   new row (or a reversal row). The feed reads chronologically.
3. **Idempotent auto-records.** Nomi-driven sales are keyed
   `unique(order_id, listing_id)` and inserted on-conflict-do-nothing, so a
   re-run of the order-status route never double-books.
4. **Derive aggregates.** Quantity, basis, and P&L roll up from these tables via
   the existing `sync_collection_from_lots` trigger and SQL views — the same
   pattern lots already use to feed `collections`.

---

# Phase 1 — Dispositions + realized P&L (auto, on-platform)

**Goal:** when a card you listed sells through Nomi, the sale records itself —
basis closed, proceeds + fees captured, realized gain computed — and your
portfolio shows Realized P&L. Zero manual bookkeeping.

### Schema (`migration: collection_sales`)

```sql
alter table listings
  add column collection_id uuid references collections(id) on delete set null;
  -- set when a listing is created from the collection panel ("List for sale").

create table collection_sales (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade, -- seller
  card_id       text not null,
  collection_id uuid references collections(id) on delete set null,      -- line closed
  order_id      uuid references orders(id) on delete set null,           -- null = manual
  listing_id    uuid references listings(id) on delete set null,
  channel       text not null default 'nomi' check (channel in ('nomi','manual')),
  quantity      integer not null check (quantity > 0),
  gross_proceeds numeric,            -- unit_price · qty
  fees          numeric not null default 0,  -- marketplace + processing + seller fee
  net_proceeds  numeric,             -- what hit the seller's balance (payout)
  cost_basis    numeric,             -- basis of closed lots; null = unknown
  grading_company text,
  grade         text,
  sold_at       timestamptz not null,
  note          text,
  created_at    timestamptz not null default now(),
  realized_gain numeric generated always as (net_proceeds - cost_basis) stored,
  unique (order_id, listing_id)      -- idempotency for auto-records
);
-- RLS: user_id = auth.uid() for select; writes via service-role (auto) or owner (manual).
```

### Closing lots — `close_collection_lots(p_collection_id, p_quantity)`

A `security definer` function that trims the line's lots **oldest-first**, sums
the basis of what it closed (`price_paid·closed + proportional grading_cost`),
and returns that basis. The `sync_collection_from_lots` trigger then rolls the
line's quantity down (and deletes the line if it hits zero — its history lives
in `collection_sales`, which survives via `on delete set null`).

```
returns numeric  -- total cost basis of the p_quantity closed (null if no priced lots)
```

### The hook (auto-disposition)

In [`/api/admin/orders/[orderId]/status`](../src/app/api/admin/orders/[orderId]/status/route.ts),
inside the existing `status === 'authenticated'` block (right where the seller's
`balance` + `credit_transactions` are written), add `recordSaleDispositions(order)`:

For each `order_item` (joined to its `listing`):
1. `collection_id = listing.collection_id` (may be null).
2. `cost_basis = collection_id ? close_collection_lots(collection_id, qty) : null`.
3. Compute per-line fees + net via the stored order breakdown (or `calculatePayout`).
4. `insert into collection_sales (... order_id, listing_id, channel:'nomi' ...) on conflict do nothing`.

Mirrors the buyer-side `upsert_collection_increment` auto-add on delivery.

### "List for sale" passes the line

[ListModal](../src/components/card/ListModal.tsx) →
[`/api/listings`](../src/app/api/listings/route.ts) gains an optional
`collection_id`, threaded from the panel's
[`onList(row)`](../src/components/collection/CollectionPositionPanel.tsx) (the
row's collection line id). Listings made outside the collection (sell wizard,
bulk) leave it null → those sales record with `cost_basis = null` (proceeds-only;
shown in the ledger, excluded from realized P&L until a basis is supplied).

### Refund/cancel reversal

If an `authenticated` order later goes `refunded`/`cancelled`, insert a
**reversal**: a negative-quantity `collection_sales` row referencing the
original, and re-open the basis as a fresh lot (`upsert_collection_increment`)
so the holding returns. Keeps history append-only and the portfolio honest.

### UI (Phase 1)

- **Portfolio summary** (on [`/collection`](../src/app/(site)/collection/page.tsx)
  header and the profile page): add **Realized**, **Unrealized**, **Total return**
  stats. Realized = `Σ collection_sales.realized_gain`.
- The "In your collection" panel's value bar can show unrealized gain (already
  partly there).

---

# Phase 2 — Per-card history + manual sells + grading cost

**Goal:** click a card → its full activity feed. Record off-platform sales and
grading by hand. Capitalize grading cost into basis.

### Schema additions

```sql
alter table collection_lots add column grading_cost numeric not null default 0;
-- folded into the line's basis by sync_collection_from_lots:
--   acquired_price = (Σ price_paid·qty + Σ grading_cost) / Σ qty

create table collection_adjustments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  card_id       text not null,
  collection_id uuid references collections(id) on delete set null,
  type          text not null check (type in ('grade','basis','note')),
  from_grade    text,  to_grade text,           -- for 'grade'
  amount        numeric,                          -- grading fee / basis delta
  happened_at   timestamptz not null,
  note          text,
  created_at    timestamptz not null default now()
);
```

### The activity feed — view `collection_activity`

A `union all` over the three operational tables, normalized to one shape, so the
feed and the global ledger are a single query:

```
(user_id, card_id, collection_id, kind, happened_at, quantity, amount, basis, ref_order_id, ref_listing_id, meta)
  kind ∈ 'buy'   ← collection_lots        (amount = price_paid, basis = cost)
       | 'sell'  ← collection_sales       (amount = net_proceeds, basis = cost_basis, realized)
       | 'grade' ← collection_adjustments (amount = grading fee, from/to grade)
```

### Re-grade as a transfer

Sending a raw card to grading and getting a slab = close the lot on the raw line
(a **transfer**, not a sale) and open a lot on the graded line carrying
`basis + grading_cost`; write a `collection_adjustments` row `type='grade'`. This
replaces the removed inline "regrade" path from the lots work, now modeled as a
first-class, logged event.

### Manual sell + manual grading

- `POST /api/collection/sales` — record an off-platform sale (`channel:'manual'`):
  pick the line, quantity, proceeds, date; closes lots + computes basis exactly
  like the auto path.
- `POST /api/collection/adjustments` — record grading (cost + outcome grade),
  driving the re-grade transfer above.

### UI (Phase 2)

- The "In your collection" panel gets a **History** affordance per card →
  opens a feed (modal/drawer): buys, the grade event, sells, each with running
  realized gain. Robinhood-style activity list.
- "Record a sale" and "Record grading" actions in the card editor.

---

# Phase 3 — Global ledger, cost-basis method, export

**Goal:** one page for every transaction across the whole collection, plus the
numbers you'd hand an accountant.

### `/collection/activity` page

The `collection_activity` view across all cards, filterable (card, kind, date,
channel), with a header summary: total invested, realized, unrealized, total
return, win rate. Sortable table, one row per event.

### Cost-basis method

Default **specific-line / oldest-lot-first** (Phase 1's `close_collection_lots`).
Once the panel shows per-lot rows, allow **specific-lot** selection at list time
(bind `listings.lot_id`) for exact control. A per-user `cost_basis_method`
preference (`fifo` | `lifo` | `specific`) can tune `close_collection_lots`.

### Export

`GET /api/collection/export` → CSV in a Schedule-D shape: one row per closed
disposition — *description, date acquired, date sold, proceeds, cost basis,
gain/loss*. Lots that contributed to a partial close are split proportionally.

### Portfolio analytics

- Total return chart over time (extends the existing value-series API to net out
  dispositions).
- Best/worst realized trades, holding-period (short vs long), per-set P&L.

---

## Build order & dependencies

```
Phase 1  ── collection_sales + listings.collection_id + close_collection_lots
         ── auto-disposition hook + realized/unrealized summary           ← ships value alone
Phase 2  ── grading_cost + collection_adjustments + collection_activity view
         ── per-card feed + manual sell/grade                              ← needs P1 tables
Phase 3  ── /collection/activity page + cost-basis method + CSV export     ← needs P2 view
```

Each phase is independently shippable and reads the previous phase's tables.

## Open decisions (defaults chosen; override before Phase 1)

- **Lot selection on sale:** default oldest-lot-first within the listed line.
  Specific-lot selection deferred to Phase 3 (needs per-lot list UI).
- **Empty line after full sale:** the line is deleted (history persists in
  `collection_sales`). Alternative: keep a zero-qty line for "still tracked."
- **No-basis sales** (listed outside the collection): recorded as proceeds-only,
  excluded from realized P&L until a basis is attached. Alternative: don't record.
