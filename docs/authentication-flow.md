# Authentication Flow

Technical reference for the redesigned admin authentication step (the `received → authenticated | exception_review` transition). For the user-facing rationale see [designs/authentication-flow.md](../designs/authentication-flow.md). For the intake-receiving step that runs *before* this, see [admin-intake-flow.md](./admin-intake-flow.md) — this doc takes over from the moment all items are scanned and the order has been physically received.

## TL;DR

Replaces the silent "Verify" button with a branching decision tree: Authentic/Fake binary → Near Mint or Exceptions → exception subtype → automatic downstream action (consignment, buyout, return, destroy). Adds a new order status `exception_review` for orders that aren't a clean Authentic+NM pass or a clean Fake-out. Side-effects (consignment listing, buyer email, payout gating) are triggered by the decision endpoint so the admin doesn't have to remember a checklist.

## Current state (what's broken / missing)

| Symptom | Where | Root cause |
|---|---|---|
| "Verify Items" button does nothing visible | [`intake/page.tsx` OrderDetailsStep around L1083](../src/app/admin/intake/page.tsx) | `POST /api/admin/intake/verify` returns `{ success: true }` with no UI follow-through and no progress affordance |
| Admin can flag items but no downstream action fires | [`flag/route.ts`](../src/app/api/admin/intake/flag/route.ts) | Flag only inserts an `intake_issues` row + sets `intake_status='flagged'`. No order-state change, no consignment, no buyer notification |
| Order can move to `authenticated` only if all items are `verified` or `resolved` | [`status/route.ts` L70-86](../src/app/api/admin/orders/[orderId]/status/route.ts) | Gate works, but `resolved` is only set by `triage/resolve` — there's no resolution endpoint reachable from a flagged item |
| No concept of "Fake" outcome | All over | The system models everything as a verification status, not as an authentication decision |
| Damage capture is free-text only | `intake_issues.description` | Can't aggregate or route based on damage attribution |

## Schema changes

New migration: `supabase/migrations/<next-timestamp>_authentication_flow.sql`

### Add to `order_status` enum

```sql
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'exception_review';
```

`exception_review` sits between `received` and `authenticated` / `cancelled`. Transitions:

- `received → authenticated` — clean Authentic + Near Mint
- `received → exception_review` — anything else
- `exception_review → authenticated` — exception resolved as "ship anyway" (rare; e.g. Conditional → buyer accepted partial refund)
- `exception_review → cancelled` — exception resolved as buyout-and-cancel
- `exception_review → shipped_to_buyer` — shouldn't happen directly; resolution always routes through authenticated or cancelled

### Add to `order_items`

| Column | Type | Purpose |
|---|---|---|
| `auth_decision` | `auth_decision` enum | `authentic` \| `fake` \| `pending` (default). Captures the binary first decision |
| `auth_condition` | `auth_condition` enum | `near_mint` \| `exception` \| NULL. Set only if `auth_decision='authentic'` |
| `exception_type` | `exception_type[]` array | `incorrect_product` \| `fake` \| `conditional` \| `physical_damage`. Array so a single item can carry multiple exceptions (e.g. Wrong Card AND Heavily Played) |
| `exception_details` | JSONB | Subtype-specific structured data — see below |
| `auth_decided_at` | TIMESTAMPTZ | |
| `auth_decided_by` | UUID FK profiles | The authenticator |

### `exception_details` JSONB shape

Discriminated by `exception_type`. Examples:

```jsonc
// incorrect_product
{
  "incorrect_product": {
    "received_type": "slab",          // "wrong_card" | "slab" | "raw"
    "received_card_id": "OP07-119_p2", // populated when received_type=wrong_card
    "received_card_name": "Portgas D. Ace (alt art)"
  }
}

// conditional
{
  "conditional": {
    "actual_condition": "lightly_played", // "lightly_played" | "heavily_played"
    "damage_areas": ["corners", "edges"]  // free-form for now; will be enumified later
  }
}

// physical_damage
{
  "physical_damage": {
    "attribution": "courier",  // "courier" | "nomi" | "seller"
    "notes": "Crease across top-right corner; visible in photo 2"
  }
}

// fake
{
  "fake": {
    "disposition": "destroyed", // "return_to_seller" | "destroyed"
    "disposition_chosen_at": "2026-05-24T14:00:00Z"
  }
}
```

### New tables

```sql
-- Tracks the consignment listing spawned by an exception resolution.
-- One per (order_item that turned into consigned inventory).
CREATE TABLE consigned_intakes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id UUID NOT NULL REFERENCES order_items(id),
  original_seller_id UUID NOT NULL REFERENCES profiles(id),
  consigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  exception_type TEXT NOT NULL,           -- which type triggered it
  intended_relist_price NUMERIC(10,2),    -- ops sets this; nullable until set
  consignment_listing_id UUID REFERENCES listings(id), -- set when relisted
  status TEXT NOT NULL DEFAULT 'pending_relist',  -- pending_relist | listed | sold | written_off
  notes TEXT
);

-- Tracks Nomi-funded buyouts of the seller for damage attributable
-- to courier or Nomi. Separate from credit_transactions because the
-- accounting bucket is "shipping insurance claim" not "sale earned".
CREATE TABLE buyouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id UUID NOT NULL REFERENCES order_items(id),
  seller_id UUID NOT NULL REFERENCES profiles(id),
  amount NUMERIC(10,2) NOT NULL,          -- what we paid out
  reason TEXT NOT NULL,                   -- "physical_damage:courier" etc.
  credit_transaction_id UUID REFERENCES credit_transactions(id),
  carrier_claim_id TEXT,                  -- e.g. Shippo claim ref
  carrier_claim_status TEXT,              -- pending | paid | denied
  recovered_amount NUMERIC(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## State machine

The authoritative state lives in `order_items.auth_decision` + `orders.status`. They evolve together:

```
order.status='received', all items auth_decision='pending'
        │
        ├── all items authentic + near_mint → POST /finalize → order.status='authenticated'
        │
        └── any item not (authentic + near_mint) → POST /finalize → order.status='exception_review'
                │
                └── per-item resolution actions → order.status='authenticated' OR 'cancelled'
```

The transition is single-step from the admin's perspective: they make decisions on all items, then click one "Finalize Authentication" button. The server computes the right next status.

## API endpoints

### `POST /api/admin/orders/[orderId]/items/[itemId]/auth-decision`

Records (or updates, if already set) the authenticator's decision for a single item. Idempotent — re-calling with the same body is a no-op.

Body:
```typescript
{
  decision: 'authentic' | 'fake',
  condition?: 'near_mint' | 'exception',          // required if decision='authentic'
  exceptions?: Array<{
    type: 'incorrect_product' | 'fake' | 'conditional' | 'physical_damage',
    details: { ... }                                // matches schema discriminator above
  }>
}
```

Validation:
- `decision='authentic'` + `condition='near_mint'` → exceptions must be empty
- `decision='fake'` → exceptions array must contain one element with `type='fake'` (the disposition is required)
- Multiple non-fake exceptions are allowed (Incorrect Product + Conditional commonly co-occur)

Writes:
- `order_items` decision columns
- Activity log row for audit

### `POST /api/admin/orders/[orderId]/finalize-auth`

Run after all items have a decision. Computes whether the order is a clean pass (→ `authenticated`) or has exceptions (→ `exception_review`) and triggers downstream side-effects.

Side-effects (transactional, all-or-rollback):

| Item outcome | Action |
|---|---|
| `authentic + near_mint` | Credit seller balance (same logic as today's `status='authenticated'` branch) |
| `fake` (disposition=destroy) | Insert `intake_disposition` row marking "destroyed", schedule destruction in physical queue |
| `fake` (disposition=return) | Generate return label (Shippo, Nomi → seller), email seller with tracking |
| `incorrect_product` | Insert `consigned_intakes` row, decrement seller listing's inventory (it never arrived) |
| `conditional` | Insert `consigned_intakes` row |
| `physical_damage` (courier) | Insert `buyouts` row, credit seller for sale price minus consignment fee, file Shippo insurance claim |
| `physical_damage` (nomi) | Insert `buyouts` row, credit seller full sale price (no claim) |
| `physical_damage` (seller) | Insert `consigned_intakes` row (downgraded price, like Conditional) |

Side-effects (always run, never rolled back if email fails):
- Email seller (per-item summary of decisions affecting them)
- Email buyer (`exception_review` → "your order has an issue"; `authenticated` → existing template)

### `POST /api/admin/orders/[orderId]/items/[itemId]/exception/resolve`

For `exception_review` orders where the resolution requires admin or seller action after the initial decision (e.g. setting the consignment relist price, choosing fake disposition late, marking a courier claim paid).

Body discriminated by exception_type — defers detail to the implementation. Resolution updates the per-item exception_details and, when the *last* item on the order is resolved, transitions the order to `authenticated` or `cancelled` per the resolution flavor.

### Deprecated (kept for back-compat during rollout)

| Endpoint | Replaced by | Notes |
|---|---|---|
| `POST /api/admin/intake/verify` | `POST .../auth-decision` with `{decision:'authentic', condition:'near_mint'}` | Old endpoint stays as a thin shim that forwards to the new one. Removed after the new UI is live for 30 days |
| `POST /api/admin/intake/flag` | `POST .../auth-decision` with exception details | Same shim approach |

## UI

### New page: `/admin/authenticate/[orderId]`

Inspired by the GOAT verification reference. Three-pane layout:

- **Left** (~30%) — card image gallery: hero image of the physical card (admin uploads via QR-tied capture rig), plus reference shots: seller listing photos, market reference image, slab cert image (auto-fetched for graded cards via [`getPsaCertImage()`](../src/lib/psa-cert.ts) and similar BGS/CGC helpers we'll add).
- **Center** (~40%) — listing details: card name, condition seller claimed, grade/slab info, price, QR code echo. Below: the Authentic/Fake toggle with keyboard shortcuts. Below that, conditional on Authentic, the Near Mint / Exceptions toggle.
- **Right** (~30%) — exception detail panel: appears only when "Exceptions" or "Fake" is the active branch. Per-type subform (Wrong Card search, Conditional grade picker, Damage attribution picker, etc.) with the form structure shown in the design doc tree.

Sticky banner above the panes: green (Authentic + NM committed), yellow (exceptions selected, awaiting Finalize), red (Fake selected). Matches the design-doc visual sort affordance.

### Modifications to `/admin/orders`

Add an "Exception Review" section above "Received" in the [STATUS_ORDER list](../src/app/admin/orders/page.tsx). Each row shows the exception_type chips so ops can triage from the list view.

### Modifications to `/admin/orders/[orderId]`

Replace the "Verify Items" link (which routes to /admin/intake) with two buttons:
- **Authenticate** — opens `/admin/authenticate/[orderId]` (the new page). Available when `status='received'` and all items have intake-pass.
- **Resolve Exception** — appears when `status='exception_review'`. Per-item action buttons in the items list (Set Consignment Price, Mark Buyout Paid, etc.).

## Email templates

Two new buyer-facing templates in [`src/lib/email.ts`](../src/lib/email.ts):

### `sendBuyerExceptionReviewEmail`

Triggered when order transitions to `exception_review`. Body includes:
- Plain-language summary of what was found (`"The card you ordered (X) did not match the listing — it appears to be Y instead"`)
- What Nomi will do about it (refund / re-listing offer / etc., based on exception_type)
- Expected timing (currently: "you'll hear from us within 24 hours")
- CTA to view the order

### `sendBuyerExceptionResolvedEmail`

Triggered when exception resolution completes. Body depends on the resolution path:
- Refund issued → "$X has been credited to your wallet"
- Replacement found → "We found another listing of this card; here's the option"
- No replacement → "We couldn't find a replacement; full refund issued"

Seller emails for exception scenarios are added in the same file:

- `sendSellerWrongCardEmail` — Incorrect Product, asks if they want their card back or consigned
- `sendSellerConditionalEmail` — graded down, here's the new consignment price
- `sendSellerDamageEmail` — damage outcome (buyout amount or consignment)
- `sendSellerFakeEmail` — fake found, return-or-destroy decision needed (or confirmed if admin already chose)

## Frontend keyboard shortcuts

Mirroring GOAT's authenticator workflow — the muscle memory of any authenticator who's done this elsewhere will transfer. All shortcuts only fire when no input is focused:

| Key | Action |
|---|---|
| `A` | Mark Authentic |
| `F` | Mark Fake |
| `N` | (after A) Mark Near Mint |
| `E` | (after A) Open Exceptions panel |
| `1`, `2`, `3`, `4` | Select first / second / third / fourth exception type |
| `Enter` | Confirm and move to next item |
| `Esc` | Discard current item's pending decision |

## Rollout plan

1. **Ship the schema migration** (additive: new enums, new columns with safe defaults, new tables). Existing flow continues to work.
2. **Ship the new endpoints + new page** behind an admin-only feature flag (`auth_flow_v2` in `useAdminDebug`).
3. **Run dual-write for 1 week** — old verify/flag endpoints keep writing to `intake_status` AND fan out to the new `auth_decision` columns.
4. **Cut over the order detail page** to surface the new buttons. Verify the GOAT-style page on real intake.
5. **Remove the shim endpoints** after 30 days of clean operation.

## Edge cases / open implementation questions

- **Multi-item orders where one item is fake and one is authentic** — order goes to `exception_review`. Seller gets two emails (one happy-path payout, one fake-disposition). Buyer gets one email summarizing both.
- **Re-decision** — once `auth_decided_at` is set, can the admin change their mind? Yes, until `finalize-auth` is called. After finalization, an undo requires a separate `unfinalize` endpoint (not in v1 — manual SQL escape hatch only).
- **Race against status flips by a second admin** — the finalize endpoint optimistically locks on `order.status='received' AND all order_items.auth_decided_at IS NOT NULL`. Second admin gets 409.
- **What if seller has zero listings to consign against** — Wrong Card with `received_card_id` pointing to a card the seller has never listed: consigned_intake still lands with `original_seller_id = order.seller_id`; ops can decide whether to relist from a Nomi house account or contact the seller. Tracked in `notes`.
