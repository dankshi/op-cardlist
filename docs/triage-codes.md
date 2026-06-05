# Triage Codes — Reference

**Authoritative reference for `triage_packages.triage_code`** — the human-readable, package-level
identifier used at receiving when a package can't be matched to an order. Narrative + rationale +
the full intake decision tree: [`designs/triage-codes.md`](../designs/triage-codes.md). Sibling
identifier: [`docs/product-id-labels.md`](product-id-labels.md) (`order_items.product_id`).

> **Core invariant:** `triage_code` is independently generated + uniqueness-enforced (unique index +
> retry-on-collision), NOT derived from any ID. The `'T-'` prefix is load-bearing — it's how every
> consumer (intake scan router, pack-out scan) discriminates triage vs product codes. A `product_id`
> can never collide with it (the `-` isn't in the Crockford alphabet).

---

## Schema

`triage_packages` gains one column (migration
[`supabase/migrations/20260607_triage_code.sql`](../supabase/migrations/20260607_triage_code.sql)):

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | Unchanged internal handle. |
| `triage_code` | `text` `NOT NULL` `UNIQUE` | `'T-'` + 8 Crockford Base32 chars (e.g. `T-7Q3KM9XP`). |

**Generation:** `gen_triage_code()` returns `'T-'` + 8 random Crockford chars (excludes `I L O U`);
`set_triage_code()` BEFORE INSERT trigger loops until unused; `idx_triage_packages_triage_code` is the
hard guarantee. Backfill + `SET NOT NULL` + unique index applied in-migration (mirrors the `product_id`
setup in 20260606). ~32⁸ ≈ 1.1 trillion combinations — triage volume is tiny, so re-rolls are
effectively never.

---

## The label

**1.25" × 1.25" square** (254 × 254 dots @ 203 DPI), produced by the `triage_no_order` / `triage_user_id`
branches of [`print-label/route.ts`](../src/app/api/admin/intake/print-label/route.ts). QR encodes
`triage_code` (the `-` is valid QR alphanumeric → stays a 21-module v1 QR at mag 5). Below the QR:
`triage_code` in large type, a sub-line (`NO ORDER` or `SELLER: <name>`), and `TRK <last 8>`. The route
looks up `triage_code` by `triagePackageId` via the admin client. `zebra.ts#printTriageLabel` signature
is unchanged.

---

## Scan / resolution

| Consumer | File | Behavior |
|----------|------|----------|
| **Intake scan router** | [`src/app/admin/intake/page.tsx`](../src/app/admin/intake/page.tsx) `handleScan` | `^T-[0-9A-Z(crockford)]{8}$` → `GET /api/admin/intake/triage?code=…`. Legacy `TRIAGE:<uuid>` still resolves via `?id=`. |
| **Triage lookup** | [`src/app/api/admin/intake/triage/route.ts`](../src/app/api/admin/intake/triage/route.ts) | `GET` accepts `?code=` (uppercased, `.eq('triage_code', …)`) or `?id=` (legacy). |
| **Pack-out scan** | [`src/app/api/admin/pack/lookup/route.ts`](../src/app/api/admin/pack/lookup/route.ts) | Rejects `T-…` (and legacy `TRIAGE:`) with a `wrong_label` "use Intake" hint. |

`TriagePackage` TS type (`src/types/database.ts`) carries `triage_code: string`. New triage packages
get a code automatically (trigger fires on the `POST /api/admin/intake/triage` insert).

---

## Gotchas / invariants

- **Don't drop the `'T-'` prefix** — it's the discriminator, not decoration.
- **Don't derive `triage_code` from anything** — generate-and-check only.
- The unique index is load-bearing; never drop it without a replacement guarantee.
- Lengthening the random part is back-compatible (bump `gen_triage_code()` + the `handleScan` regex);
  shortening is not.
