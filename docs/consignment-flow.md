# Consignment Flow

> Human-readable summary for stakeholders: [designs/consignment-flow.md](../designs/consignment-flow.md).
> Related: the receiving flow this reuses — [docs/admin-intake-flow.md](admin-intake-flow.md);
> product QR identity — [docs/product-id-labels.md](product-id-labels.md);
> pricing anchors — [docs/raw-pricing.md](raw-pricing.md), [docs/slab-pricing.md](slab-pricing.md).

## Overview

Consignment lets a seller hand their cards to nomi and have nomi do all the listing
work: receive, verify, photograph, price, list under the seller's profile, and pay
the seller (minus a commission) as each card sells. The card stays the **seller's
property until it sells** — this is consignment, not a buyout.

This **unifies and supersedes** the old `consigned_intakes` table (originally in
[20260603_authentication_flow.sql](../supabase/migrations/20260603_authentication_flow.sql)),
which modeled only the exception origin as a separate table. It's the *same* economic
model — seller keeps the proceeds minus a commission — so there's no reason for two
tables. The exception path is now just a third `channel` on the unified model.
`20260713_consignment_flow.sql` migrates the old rows in and drops `consigned_intakes`.
(`buyouts` is unchanged — that's the genuinely nomi-owned bucket for courier/nomi
damage, a different thing from consignment.)

Three origins, one data model:

| Channel | Who drives it | How the card is identified |
|---|---|---|
| **Ship-to-nomi** (mail-in) | Seller builds the manifest online, then mails the batch | Seller pre-enters each card; admin scans the batch QR and confirms physically |
| **In-store / drop-off** | Admin, with the seller present | Admin scans the seller QR, then card-search / card-scan each item on the spot |
| **Exception** (involuntary) | Auto-created by `finalize-auth` when an order hits an authentication exception | Card already in hand from the order; linked back via `origin_order_item_id` |

The mail-in path is the efficient default: because the seller pre-registers the
manifest, admin intake collapses to **scan-the-batch → one-click-confirm per card**,
the same ergonomics as the existing order-intake happy path. The exception path needs
no intake at all — the card is already here, so its item starts at `confirmed`.

---

## Design philosophy & scope

This mirrors the [receive-flow philosophy](../designs/receive-flow.md): **solo-operator
simplicity, reuse over rebuild.** Consignment is almost entirely a thin orchestration
layer over systems that already exist.

### What we reuse (do not rebuild)

| Need | Existing system | Reference |
|---|---|---|
| Card identity QR + thermal label | `product_id` generator + `print-label` | [product-id-labels.md](product-id-labels.md), `src/app/api/admin/intake/print-label/route.ts` |
| Scan-to-resolve a physical card | intake scan resolver | `src/app/api/admin/intake/scan/route.ts` |
| Find a card without a UPC | `searchCards()` typeahead | `src/lib/cards.ts` |
| Suggested list price | raw + slab market values | `raw_market_values`, `slab_market_values` |
| Photo capture | intake photo upload | `src/app/admin/intake/page.tsx` |
| The listing itself | `listings` table under the seller's `seller_id` | `20260226_create_marketplace.sql` |
| Sale, escrow, ship-to-buyer | existing order lifecycle | order_status enum |
| Seller payout | wallet credit ledger | [credits-and-wallet.md](credits-and-wallet.md), [wallet-cashout.md](wallet-cashout.md) |
| Discrepancy triage | `intake_issues` pattern | [admin-intake-flow.md](admin-intake-flow.md) |
| Tier-aware commission | `src/lib/fees.ts` | [tier-aware-pricing.md](../designs/tier-aware-pricing.md) |

New code is thin: **two tables**, the **seller submission UI** (`/sell/consignment`),
and a **consignment admin surface** (`/admin/consignments`).

### What we deliberately defer (v1)

| Item | Why deferred | Reconsider when |
|---|---|---|
| Grading-as-a-service (nomi submits raw → PSA/BGS) | v1 lists raw or accepts pre-graded slabs only; grading service is a separate capitalized-cost workflow (`regrade_one_copy`) | Sellers ask nomi to grade for them at volume |
| Phone-camera card recognition (CV) | Consistent with the [slab-ingestion](slab-ingestion.md) deferral; search-by-name + variant pick covers identification | A reliable model exists and counter typing is the bottleneck |
| Per-card seller-printed labels | One batch slip is enough; nomi prints `product_id` labels at intake | Sellers want to pre-label for faster receiving |
| Multi-warehouse / station routing | Solo-operator volume (see receive-flow) | >1 receiving station |
| Upfront buyout option at submission | v1 is commission-at-sale only | Product decides to fund inventory purchases |

---

## Vocabulary

- **Submission** — one consignment batch from one seller (`consignment_submissions`).
- **Submission code** — Crockford Base32 short code + QR printed on the batch packing
  slip; scanning it at intake loads the whole manifest. Same scheme as `product_id` /
  `triage_code` (see [triage-codes.md](triage-codes.md)).
- **Manifest** — the list of cards the seller declared in a `ship_in` submission.
- **Declared vs actual** — what the seller said (condition / grade) vs what intake
  verified. A material mismatch becomes a **discrepancy**.
- **Pending (seller hub)** — a confirmed-but-not-yet-listed consignment item, shown in
  the seller's inventory so they can see nomi has the card.

---

## Submission lifecycle

```
                 ┌──────────── ship_in ────────────┐        ┌──── drop_off ────┐
  seller builds  │                                  │  admin scans seller QR    │
  manifest ───►  draft ──lock──► awaiting_shipment   │  creates submission live  │
                 │                    │              │            │              │
                 │              seller ships         │     (no manifest)         │
                 │                    ▼              │            ▼              │
                 └──────────────► in_transit ────────┴──► received ──► processing
                                                                          │
                                                          all items confirmed,
                                                          photographed, priced
                                                                          ▼
                                                                       listed
                                                                          │
                                            every item sold or returned   ▼
                                                                       closed
```

| Status | Set when | Channel |
|---|---|---|
| `draft` | Seller is building the manifest online | ship_in |
| `awaiting_shipment` | Manifest locked, batch label + slip generated | ship_in |
| `in_transit` | Seller marks shipped / tracking shows movement | ship_in |
| `received` | Package scanned in at `/admin/consignments` | both |
| `processing` | Items being confirmed / photographed / priced | both |
| `listed` | All non-discrepancy items have live listings | both |
| `closed` | Every item sold, returned, or rejected | both |

### Per-item status

```
expected ─► received ─► confirmed ─► listed ─► sold
   │            │           │
   │            │           └─(material mismatch)─► discrepancy ─► (accept terms → confirmed)
   │            │                                                  (return → returned)
   └────────────┴──(not in package / fake / unidentifiable)────► rejected
```

| Item status | Meaning |
|---|---|
| `expected` | Declared in a ship_in manifest, not yet in hand |
| `received` | Physically present at nomi |
| `confirmed` | Matched to a `card_id`, condition/grade verified, `product_id` label printed, **shown Pending in seller hub** |
| `discrepancy` | Declared vs actual mismatch — routed to triage, seller notified |
| `listed` | A `listing` row is live under the seller's profile |
| `sold` | The listing sold; payout settled to seller wallet |
| `returned` | Sent back to the seller (their choice after a discrepancy) |
| `rejected` | Not received, counterfeit, or unidentifiable — closed without listing |

---

## Data model

Two tables, replacing the old `consigned_intakes`. A single `fee_bps` applies
regardless of origin (one consignment rate — no exception "penalty" fee).

### `consignment_submissions`

```sql
CREATE TABLE consignment_submissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id       UUID NOT NULL REFERENCES profiles(id),
  channel         TEXT NOT NULL CHECK (channel IN ('ship_in', 'drop_off', 'exception')),
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','awaiting_shipment','in_transit',
                                      'received','processing','listed','closed')),
  submission_code TEXT UNIQUE,              -- Crockford Base32, QR on the batch slip ('C-' prefix)
  fee_bps         INTEGER,                  -- snapshot of seller's consignment commission (basis points)
  origin_order_id UUID REFERENCES orders(id),  -- set for channel='exception' (one submission per order)
  shippo_label_id TEXT,                     -- inbound insured label (ship_in)
  tracking_number TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at    TIMESTAMPTZ,             -- manifest locked
  received_at     TIMESTAMPTZ,
  closed_at       TIMESTAMPTZ
);
-- partial unique index on origin_order_id (where not null): one exception submission per order
```

`submission_code` is generated the same way as `product_id` / `triage_code`:
collision-checked Crockford Base32 via a `BEFORE INSERT` trigger (see
[product-id-labels.md](product-id-labels.md)). `fee_bps` is snapshotted at lock time so
a later tier change doesn't retroactively alter a seller's payout.

### `consignment_items`

```sql
CREATE TABLE consignment_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id      UUID NOT NULL REFERENCES consignment_submissions(id) ON DELETE CASCADE,
  seller_id          UUID NOT NULL REFERENCES profiles(id),     -- denormalized for RLS / hub queries
  card_id            TEXT,                  -- set at manifest (ship_in) or at confirm (drop_off/exception)
  kind               TEXT NOT NULL CHECK (kind IN ('raw','slab')),

  -- exception origin (null for seller-initiated items)
  origin_order_item_id UUID REFERENCES order_items(id),
  exception_type       TEXT,                -- incorrect_product | conditional | physical_damage | ...

  -- what the seller declared
  declared_condition card_condition,        -- raw only
  declared_company   TEXT,                  -- slab only: PSA|CGC|BGS|TAG
  declared_grade     TEXT,                  -- slab only
  declared_cert      TEXT,                  -- slab only

  -- what intake verified (null until confirmed)
  actual_condition   card_condition,
  actual_company     TEXT,
  actual_grade       TEXT,
  actual_cert        TEXT,

  product_id         TEXT,                  -- scannable label code; shares the order_items code space (not a FK)
  suggested_price    NUMERIC(10,2),         -- snapshot from market value at confirm
  ask_price          NUMERIC(10,2),         -- seller/admin chosen list price
  reserve_price      NUMERIC(10,2),         -- optional floor
  listing_id         UUID REFERENCES listings(id),
  photo_urls         TEXT[] NOT NULL DEFAULT '{}',
  notes              TEXT,

  status             TEXT NOT NULL DEFAULT 'expected'
                       CHECK (status IN ('expected','received','confirmed',
                                         'discrepancy','listed','sold','returned','rejected')),
  discrepancy_kind   TEXT,                  -- 'condition' | 'wrong_card' | 'counterfeit' | 'not_received' | 'other'
  discrepancy_note   TEXT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at       TIMESTAMPTZ,
  listed_at          TIMESTAMPTZ,
  resolved_at        TIMESTAMPTZ
);

CREATE INDEX idx_consignment_items_submission ON consignment_items(submission_id);
CREATE INDEX idx_consignment_items_seller     ON consignment_items(seller_id);
CREATE INDEX idx_consignment_items_status     ON consignment_items(status);
CREATE INDEX idx_consignment_items_listing    ON consignment_items(listing_id);
```

> **`product_id` note:** consistent with [product-id-labels.md](product-id-labels.md),
> `product_id` is a **self-contained label code, not a FK**. Consignment items reuse the
> existing `gen_product_id()` generator so they share one code space with `order_items`
> — the scan resolver can route a scanned code to either table. The column is **nullable
> and assigned at confirm** (not insert): a `ship_in` item starts `expected` with no
> physical card yet. A partial unique index enforces uniqueness among assigned codes; the
> confirm endpoint checks both `order_items` and `consignment_items` before assigning to
> avoid a cross-table collision.

### Exception-origin items

`finalize-auth` creates one `channel='exception'` submission per order (get-or-create
on `origin_order_id`, idempotent on re-finalize) and one `consignment_item` per flagged
card, carrying `origin_order_item_id` + `exception_type`. These skip the seller-facing
states and start at `confirmed` (the card is already in hand). The
`/admin/inventory` "Consignment" tab reads exactly these (filtered to
`channel='exception'`); `resolve-exception` sets their `ask_price`. The old
`consigned_intakes` status names map: `pending_relist→confirmed`, `listed→listed`,
`sold→sold`, `written_off→rejected`.

### RLS

Carries over the old `consigned_intakes` policy intent: admins manage everything;
sellers can read (and, while `status='draft'`, write) their own rows. Sellers may only
create `ship_in`/`drop_off` submissions — `exception` rows are admin/server-created.

```sql
ALTER TABLE consignment_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE consignment_items       ENABLE ROW LEVEL SECURITY;

-- Admins: full access (is_admin via profiles)
-- Sellers: SELECT where seller_id = auth.uid();
--          INSERT/UPDATE only on own draft submissions and their items.
```

### Linking a sale back to the consignment

A consignment `listing` is an ordinary listing with `seller_id = original seller`. When
it sells, the order flows through the normal lifecycle **but skips the seller-ship leg**
(the card is already at nomi). Settlement reads `consignment_items.fee_bps` (via the
parent submission) to split proceeds: commission to nomi, remainder credited to the
seller's wallet through the existing ledger.

---

## Seller-facing flow (`/sell/consignment`)

Replaces the current coming-soon page
([src/app/(site)/sell/consignment/page.tsx](../src/app/(site)/sell/consignment/page.tsx)),
gated behind a feature flag + seller approval.

### Ship-to-nomi

1. **Start.** "Start a consignment" → choose **Ship it in**. Creates a `draft`
   submission.
2. **Build the manifest.** For each card:
   - Search by name / set-number (`searchCards`); pick the exact variant (the
     `_p`/`_r` disambiguation from [card.ts](../src/types/card.ts)).
   - **Raw** → declare `card_condition`.
   - **Slab** → enter company + grade + cert; we pre-validate the cert format and
     pre-fill the suggested price from `slab_market_values`.
   - Show the live **suggested price** (raw or slab market value, with its confidence
     badge) as the default ask; seller may override or set a reserve.
3. **Review payout.** Show the consignment commission (tier-aware, `fees.ts`) and the
   estimated net per card and for the batch.
4. **Lock & label.** Locking the manifest → `awaiting_shipment`; generate one insured
   Shippo label + a printable **batch packing slip with the submission QR**.
5. **Ship.** Seller packs everything, attaches the label, drops off → `in_transit`.
6. **Track.** Seller hub → **Consignments** tab shows the batch and each card moving
   through received → confirmed (Pending) → listed → sold → paid.

### In-store / drop-off

No pre-work required from the seller — they just present their **seller QR**. (If they
*did* pre-build a manifest, they can present the submission QR instead to skip data
entry.) All data entry happens admin-side, below.

---

## Admin-facing flow

New surface under the admin shell (reuses `AdminNav`, `Field`, `StatusBadge`,
`RawRecordGrid` — see [admin-site-overhaul.md](admin-site-overhaul.md)).

### `/admin/consignments` (list)

GOAT's "Store Receptions" list, adapted. Filters: status, seller, channel, date.
"New Consignment" button. Columns: ID, seller, channel, status, # items, created.

### `/admin/consignments/[id]` (intake + processing)

**A. Open the batch**

- **Drop-off:** scan **seller QR** (or search seller) → confirm seller card (id,
  username, email, phone, like GOAT's Confirm Seller) → create a `drop_off` submission.
- **Mail-in:** scan the **submission QR** → loads the existing submission and its
  `expected` manifest.

This surface is **consignment-only** — no order/consignment mode toggle (we never
intake orders here), no station field.

**B. Add / confirm cards**

- **Mail-in (scan-to-confirm):** for each manifest line, pull the physical card,
  click **Confirm** if it matches (one click). Correct condition/grade if reality
  differs — a material delta flips the item to `discrepancy` and notifies the seller.
- **In-store (search / scan):** find the card via search-by-name typeahead (cards have
  no UPC) or the card-scan fallback; pick the variant; set raw condition or slab
  company+grade+cert; **Confirm**.
- On confirm, each card: gets a `product_id` + QR label (existing `print-label`
  route), snapshots `suggested_price` from market values, and appears as **Pending**
  in the seller's hub inventory.

**C. Submit batch** → `processing`.

**D. Process (photograph → price → list)**

- Capture studio photos per item (reuse intake upload).
- Confirm `ask_price` (defaults to suggested; admin may override).
- **Publish** → creates a `listings` row with `seller_id = original seller`,
  `source='consignment'`, `card_id`, `condition`/grade, `price = ask_price`,
  `photo_urls`; sets `consignment_items.listing_id` and item status `listed`. When all
  non-discrepancy items are listed, submission → `listed`.

**E. Discrepancies** route to the `intake_issues`-style queue. The seller is notified
and chooses: **accept the corrected terms** (→ `confirmed`, continue) or **request
return** (→ `returned`).

### Sale & payout

A consignment listing sells like any other, but the order **skips `seller_shipped` /
`received`** (card already in hand) and goes straight to pack-out
([packing-flow.md](packing-flow.md)). On settlement, proceeds split per the snapshotted
`fee_bps`: commission to nomi, remainder credited to the seller's wallet
([credits-and-wallet.md](credits-and-wallet.md)). Item → `sold`; when all items are
`sold`/`returned`/`rejected`, submission → `closed`.

---

## API surface (new)

| Route | Method | Purpose |
|---|---|---|
| `/api/consignment/submissions` | POST | Seller: create a `draft` |
| `/api/consignment/submissions/[id]/items` | POST / DELETE | Seller: add/remove manifest lines (draft only) |
| `/api/consignment/submissions/[id]/lock` | POST | Seller: lock manifest → label + slip + QR |
| `/api/consignment/submissions/[id]/ship` | POST | Seller: mark shipped (tracking) |
| `/api/admin/consignments` | GET | Admin: list/filter |
| `/api/admin/consignments/scan` | POST | Admin: resolve seller QR or submission QR |
| `/api/admin/consignments/[id]/confirm-item` | POST | Admin: confirm a card (prints label, → Pending) |
| `/api/admin/consignments/[id]/discrepancy` | POST | Admin: flag declared-vs-actual mismatch |
| `/api/admin/consignments/[id]/list-item` | POST | Admin: publish a `listing` for an item |

Settlement hooks into the existing order/escrow webhook path; no new payout endpoint.

---

## Key files

```
src/
├── app/
│   ├── (site)/sell/consignment/page.tsx        # seller submission flow (replaces coming-soon)
│   ├── (site)/sellerhub/                        # + Consignments tab (status per item)
│   ├── admin/consignments/page.tsx              # admin list (Store-Receptions equivalent)
│   ├── admin/consignments/[id]/page.tsx         # intake + processing
│   └── api/
│       ├── consignment/...                      # seller endpoints
│       └── admin/consignments/...               # admin endpoints
├── lib/
│   ├── cards.ts                                 # searchCards (card identity, no UPC)
│   ├── fees.ts                                  # tier-aware consignment commission
│   └── consignment.ts                           # NEW: status transitions, payout split
supabase/migrations/
└── <date>_consignment_flow.sql                  # consignment_submissions + consignment_items + RLS
```

## Open questions

- **Commission rate** — flat consignment % or distinct from the marketplace sell fee?
  Resolve in `fees.ts` before the migration snapshots `fee_bps`.
- **Reserve / unsold handling** — after N days unsold, auto-reprice, return, or roll
  into a buyout offer? (Buyout is a deferred v2 lever.)
- **Cert verification depth** — pre-validate slab certs against PSA/BGS pop lookups at
  manifest time, or only at intake? ([bgs-integration.md](bgs-integration.md),
  [PSA-POP-MATCHING.md](PSA-POP-MATCHING.md)).
