# Collection lots (per-acquisition cost basis)

A collection **line** is one card+variant a user owns (e.g. "raw Near Mint
Ms. All Sunday"). A line can now be made up of several **lots** — distinct
acquisitions, each with its own `quantity`, `price_paid`, and `acquired_date`.
This lets a collector record buying the same card three times at three prices.

## Data model

`collection_lots` (migration `20260620_collection_lots.sql`) is the **source of
truth** for a line's quantity and cost basis:

| column | notes |
| --- | --- |
| `id` | uuid pk |
| `collection_id` | FK → `collections(id)` on delete cascade |
| `quantity` | int, `> 0` |
| `price_paid` | numeric, nullable. NULL = a "loose"/unpriced lot |
| `acquired_date` | date, nullable |

The parent `collections` row keeps its existing aggregate columns
(`quantity`, `acquired_price`, `acquired_date`) **in sync via a trigger**
(`sync_collection_from_lots`). This is the key design choice: every existing
reader keeps working unchanged against the rolled-up line —

- both valuation surfaces ([card page](../src/app/(site)/card/[cardId]/page.tsx),
  [`/collection`](../src/app/(site)/collection/page.tsx)),
- the [value-series API](../src/app/api/collection/value-series/route.ts),
- the panel reload in [CardMainPanel](../src/components/card/CardMainPanel.tsx),
- the purchase auto-add in [confirm-delivery](../src/app/api/orders/[orderId]/confirm-delivery/route.ts).

### Aggregate rules (trigger)

For a line, over its lots:

- `quantity = Σ lot.quantity`
- `acquired_price = round(Σ(price_paid·quantity) / Σ quantity, 2)` when at least
  one lot is priced, else `NULL`. Spreading total cost across **every** copy
  means readers that compute `acquired_price · quantity` still get the exact
  total cost basis (and thus correct gain/loss). The per-card figure is a
  blend when some copies are unpriced.
- `acquired_date = max(lot.acquired_date)`

If a line's **last** lot is deleted, the lots API deletes the now-empty line.

## Write paths

- **`upsert_collection_increment` RPC** (unchanged signature) creates lots
  instead of bumping the line directly. Rule: an **unpriced** add merges into
  the line's existing unpriced lot (so repeated quick-adds stay one tidy pile);
  a **priced** add is its own lot. Used by manual add
  ([`/api/collection` POST](../src/app/api/collection/route.ts)) and purchase
  auto-add.
- **`/api/collection/lots`** ([route](../src/app/api/collection/lots/route.ts)):
  - `GET ?collection_id=` — list a line's lots (loose first, then oldest).
  - `POST {collection_id, quantity, price_paid?, acquired_date?}` — add a lot.
  - `POST {collection_id, action:'set_total', total_quantity}` — drive a line's
    total quantity by growing/shrinking the loose lot (then trimming the
    most-recent priced lots). Backs the inline `−/N/+` stepper so a quick
    quantity tweak never needs a price.
  - `PATCH {id, quantity?, price_paid?, acquired_date?}` — edit a lot.
  - `DELETE ?id=` — remove a lot; deletes the parent line if it was the last.
- **`/api/collection` PATCH** now only writes **variant-level** fields
  (`notes`, `custom_value`, `serial_number`). Quantity / price / date moved to
  the lots endpoint, so the old quantity-write + regrade-merge logic is gone.

## RLS

A lot is owned by whoever owns its parent line. One `for all` policy on
`collection_lots` gates every op with
`exists (select 1 from collections c where c.id = collection_id and c.user_id = auth.uid())`.
The sync trigger is `security definer` so it can roll up the parent line
regardless of which row fired it (the lot write was already authorized).

## UI

- [AddEditCardModal](../src/components/collection/AddEditCardModal.tsx) — the
  **Acquisitions** section repeats one row per lot (qty stepper, price, date)
  with "Add another acquisition". Add mode creates the line + first lot via the
  RPC, then appends extra lots; edit mode loads lots and diffs them
  (create/update/delete) on save. Grade is chosen on add and shown read-only in
  edit (a line's variant is fixed once created).
- [CollectionPositionPanel](../src/components/collection/CollectionPositionPanel.tsx)
  — shows the per-variant aggregate; the inline quantity stepper routes through
  `set_total`.

## Known trade-offs

- The panel still shows **one row per variant** (aggregate), not per lot. Lots
  are surfaced in the Edit modal. Showing each lot inline would mean reworking
  both valuation pages to emit per-lot rows.
- Regrading an existing line is no longer inline (remove + re-add) — the old
  grade-change-with-merge path was removed because it fought the trigger.
- The `set_total` stepper reduces priced lots only after the loose lot is
  exhausted; lowering quantity past the loose pile trims real cost-basis lots.
