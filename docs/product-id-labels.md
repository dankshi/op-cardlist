# Product ID Labels — Reference

**Authoritative reference for the `order_items.product_id` short code and the QR label that carries
it.** The human-readable narrative + rationale lives at
[`designs/product-id-labels.md`](../designs/product-id-labels.md).

> **Core invariant:** `product_id` is an *independently generated, uniqueness-enforced* short code —
> NOT a slice or hash of the UUID. Uniqueness is guaranteed by the unique index + retry-on-collision,
> not by the code's length. Never reintroduce a "derive it from `id`" shortcut: a derived code can
> collide with no way to resolve the collision.

---

## Schema

`order_items` gains one column (migration
[`supabase/migrations/20260606_order_item_product_id.sql`](../supabase/migrations/20260606_order_item_product_id.sql)):

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | **Unchanged.** Immutable internal handle; all FKs point here (`intake_items`, `consigned_intakes`, `raffles`, …). |
| `product_id` | `text` `NOT NULL` `UNIQUE` | 9-char Crockford Base32 label/QR code. **Not a foreign key.** |

**Format:** 9 chars from `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (Crockford Base32 — excludes `I L O U`).
~32⁹ ≈ **35 trillion** combinations.

### Generation (DB-side, all insert paths)

Two Postgres objects + a trigger do the work, so every insert route gets a code automatically with no
app changes:

- `gen_product_id()` → returns 9 random Crockford Base32 chars (`random()` is fine; uniqueness is
  enforced below, not by RNG quality).
- `set_order_item_product_id()` → BEFORE INSERT trigger. If `product_id` is null, loops
  `gen_product_id()` until it finds an unused value.
- `idx_order_items_product_id` → the `UNIQUE` index. This is the hard guarantee and the backstop for
  the (astronomically rare) same-instant concurrent collision two transactions could pick before
  either commits.

Backfill of pre-existing rows happens inside the same migration; `SET NOT NULL` + the unique index are
applied *after* the backfill, so a successful migration proves every row has a unique non-null code.

---

## The label

**1.25" × 1.25" square** (254 × 254 dots @ 203 DPI). Layout: centered QR encoding `product_id`, with
`product_id` printed below it. No card name / card_id.

Two render paths produce an identical payload (`product_id`):

| Path | File | Used when |
|------|------|-----------|
| **ZPL (fast)** | [`src/app/api/admin/intake/print-label/route.ts`](../src/app/api/admin/intake/print-label/route.ts) | A Zebra ZPL printer is reachable via BrowserPrint. Raw ZPL, no dialog. |
| **HTML (fallback)** | [`src/app/api/admin/orders/[orderId]/qr-labels/route.ts`](../src/app/api/admin/orders/[orderId]/qr-labels/route.ts) | Any other printer (ZSB, inkjet, AirPrint) — QR as `<img>`, OS print dialog. |

ZPL specifics: `^PW254` / `^LL254`; QR `^FO64,20^BQN,2,6^FDMA,<product_id>^FS` (mag 6 → a 9-char code
stays a 21-module v1 QR ≈ 126 dots, centered); text `^FO0,170^A0N,36,36^FB254,1,0,C^FD<product_id>^FS`
(centered block). The ZPL route looks up `product_id` by item id via the **admin** client
(`order_items` RLS is buyer/seller-scoped, so the user-scoped client can't see it).

---

## Scan + search resolution

Both consumers resolve against `product_id`. **No UUID back-compat** — stickers printed before
migration 20260606 (QR = UUID) no longer scan.

- **Pack-out scan** —
  [`src/app/api/admin/pack/lookup/route.ts`](../src/app/api/admin/pack/lookup/route.ts). Validates
  `^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{9}$`, normalizes the scan to uppercase (Crockford is
  case-insensitive), resolves `.eq('product_id', …)`. `TRIAGE:<id>` payloads are still rejected with a
  "wrong label" hint.
- **Admin order search** —
  [`src/app/api/admin/orders/route.ts`](../src/app/api/admin/orders/route.ts). The `search` param now
  also matches `product_id`: matching codes are resolved to their `order_id`s and folded into the
  order filter (`id.ilike.%term% , id.in.(…)`).

`OrderItem` TS type (`src/types/database.ts`) carries `product_id: string`.

---

## Gotchas / invariants

- **Don't derive from the UUID.** See the core invariant up top.
- **Old labels are dead.** Any pre-20260606 sticker (QR = UUID) returns `not_found` at pack. Re-label
  any pre-printed, un-shipped inventory.
- **Lengthening the code** is safe and back-compatible (just change `gen_product_id()` + the regex in
  pack/lookup); existing codes stay valid. **Shortening** is not (could orphan existing codes / raise
  collision pressure).
- The unique index is load-bearing — never drop it without a replacement uniqueness guarantee.
