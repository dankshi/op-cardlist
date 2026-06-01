# Admin Site Overhaul

Technical reference for the standalone admin shell, top-nav, and the order master view. For the user-facing rationale see [designs/admin-site-overhaul.md](../designs/admin-site-overhaul.md). For the pages this navigation ties together see [admin-intake-flow.md](./admin-intake-flow.md), [packing-flow.md](./packing-flow.md), and [authentication-flow.md](./authentication-flow.md).

## TL;DR

`/admin` is now its own app, not a sidebar bolted inside the orange storefront chrome. The root layout was stripped to bare `<html><body>`; all storefront routes moved into a `(site)` route group that owns the orange header/footer; `admin/` got an independent layout with a **top navbar** (hover/keyboard dropdowns: Orders → statuses, Fulfillment, Data, Community) on a neutral light+indigo palette. Every order has a **master view** at `/admin/orders/[orderId]` that surfaces every DB column of `orders` + `order_items` (incl. `order_items.id`, `listing_id`, stripe IDs, auth/intake metadata) plus joined `intake_issues`, `intake_activity_log`, `consigned_intakes`, `buyouts`, `reviews`, `credit_transactions`, and the per-item `listings` snapshot.

## Route structure (chrome split)

Route groups are transparent — folder names in `(parens)` are stripped from the URL, so **no URL changed**. `/admin` keeps static-segment precedence over the `(site)/[setId]` dynamic route.

```
src/app/
  layout.tsx            ← bare <html><body> + neutral metadata (metadataBase, icons, robots, verification)
  globals.css
  robots.ts  sitemap.ts ← special files, stay at root
  (site)/
    layout.tsx          ← orange storefront header/footer/main + storefront metadata + JSON-LD
    page.tsx            ← homepage
    marketplace/ card/ sell/ auth/ orders/ … (all ~22 storefront route folders + [setId])
  admin/
    layout.tsx          ← independent shell: server is_admin gate + <AdminNav> + slate bg
    …
  api/                  ← unchanged
```

Metadata is split deliberately: `metadataBase` lives in the bare root (must be reachable from every route, admin included, or builds warn); storefront title-template / openGraph / twitter / canonical live in `(site)/layout.tsx` so admin does **not** inherit consumer SEO chrome. The two JSON-LD `<script>` blocks moved into `(site)` too.

## Auth gate

The admin layout ([src/app/admin/layout.tsx](../src/app/admin/layout.tsx)) is a server component that calls `requireAdmin()` from [src/lib/auth.ts](../src/lib/auth.ts) — a single server-side gate for the whole section (replaces the per-page client `is_admin` checks; those can remain as belt-and-suspenders). Unauthenticated → redirect to `/auth/sign-in`; non-admin → redirect to `/`. Verified: `GET /admin` → 307, `GET /api/admin/orders/x/full` → 401.

## Navigation

[src/components/admin/AdminNav.tsx](../src/components/admin/AdminNav.tsx) (`'use client'`). Sticky top bar, white/slate, indigo active accent. Dropdowns are **state-based** (not pure CSS) so they work for hover (with a 150ms close-intent timer so the cursor can cross the gap), keyboard (`focus`/`blur` within the container), and touch (click toggle). A `pt-1` bridge spans the trigger→panel gap. The Orders dropdown lists statuses from the shared module, each linking to `/admin/orders?status=<key>`.

## Shared modules

- [src/lib/admin/orderStatus.ts](../src/lib/admin/orderStatus.ts) — `STATUS_STYLES`, `STATUS_LABELS`, `STATUS_ORDER`, `PIPELINE_STEPS`, `statusLabel()`, `statusStyle()`. Single source of truth; previously duplicated in the list and detail pages.
- [src/components/admin/ui/](../src/components/admin/ui/) — `Field`/`FieldGrid` (label/value with money/date/bool/json/id formatting), `CopyButton` (clipboard chip for UUIDs), `Section`/`EmptyHint` (titled card), `StatusBadge`.

## Orders list

[src/app/admin/orders/page.tsx](../src/app/admin/orders/page.tsx). Reads `?status=` via `useSearchParams` (wrapped in `<Suspense>` to satisfy Next's build). No param → grouped-accordion "All Orders". With param → single flat list + a "Clear filter" link. The existing `/api/admin/orders?status=` already supported the filter.

## Master view

### `GET /api/admin/orders/[orderId]/full`

[src/app/api/admin/orders/[orderId]/full/route.ts](../src/app/api/admin/orders/[orderId]/full/route.ts) (new). Admin-gated, then uses the **service-role** client (`getSupabaseAdmin()` from [src/lib/supabase/admin.ts](../src/lib/supabase/admin.ts)) because several related tables (`credit_transactions`, `buyouts`, `intake_activity_log`) aren't RLS-visible to the browser anon client the old page used. Runs the joins as a handful of **parallel** queries (`Promise.all`) rather than one giant nested PostgREST select — easier to maintain, avoids RLS-join surprises.

**Returns:** `{ order (+buyer/seller), items, listings, intake_issues, activity_log, consignments, buyouts, reviews, credit_transactions }`.

### Page

[src/app/admin/orders/[orderId]/page.tsx](../src/app/admin/orders/[orderId]/page.tsx) fetches `/full` and renders the master view, keeping all interactive controls (status transitions via `ACTIONABLE`, outbound-label generation, `printOrderQrLabels`, the received→auth CTA, `ExceptionResolutionPanel`).

**Exhaustiveness is generic, not hand-listed.** A `RawRecordGrid` dumps every key of a record via `Field`, inferring display kind from the key/value (`kindFor`): boolean→bool, object→json, `id`/`*_id`→copyable id, `*_at`→datetime, money-ish names→money, else text. This is applied to the order, each item, the listing snapshot, and every related-table row — so **new columns appear automatically** as the schema grows. Per-item consignment/buyout rows are matched on `order_item_id` and shown in collapsible `<details>`.

## Schema changes

**None.** Read-only surfacing of existing tables/columns.

## Verification

`npm run build` clean (no `metadataBase` warning). Dev smoke: `/` 200 (orange chrome + JSON-LD present), `/marketplace` `/sell` `/auth/sign-in` 200 (URLs preserved), `/sitemap.xml` 200, unknown URL 404, `/admin` 307→sign-in, `/api/admin/orders/x/full` 401. The authenticated admin UI (dropdowns, master-view rendering) needs a logged-in admin session to exercise.
