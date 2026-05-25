# Packing Flow

Technical reference for the scan-driven pack-out screen. For the user-facing rationale see [designs/packing-flow.md](../designs/packing-flow.md). For upstream context (where the Product QR is printed) see [admin-intake-flow.md](./admin-intake-flow.md); for downstream (the status transition + label this screen triggers) see [authentication-flow.md](./authentication-flow.md).

## TL;DR

New `/admin/pack` focus screen. Operator scans a Product QR (from intake) → server looks up the order, validates pack-readiness, returns a preview → operator clicks "Generate + Print Label" → server creates the Shippo label, transitions order to `shipped_to_buyer`, prints to Zebra. Reuses existing `outbound-label` and `status` endpoints + the existing print-agent — almost no new infrastructure.

## State machine

Pack-out is a one-step transition: `authenticated → shipped_to_buyer`. The screen never opens for any other state — the lookup endpoint rejects orders not in `authenticated` with a structured reason code so the UI can render the right hint (e.g. "still in exception_review, resolve first").

```
authenticated  ──[scan + click print]──► shipped_to_buyer
       │                                       │
       │                                       │
       │ (held)                                ▼
       ▼                                  delivered
shipped_to_buyer (already)
       │
       │ (re-scan → "already shipped, view label?")
       ▼
   (no-op, surface re-print link to order detail)
```

The auth check (operator must be admin) and the optimistic-lock pattern (re-check `status='authenticated'` in the `UPDATE … WHERE`) match the existing status route. No new race-safety primitives needed.

## Schema changes

**None.** All necessary columns already exist:

- `order_items.id` — the UUID encoded in the Product QR.
- `orders.tracking_number`, `orders.tracking_carrier`, `orders.outbound_label_url`, `orders.outbound_label_cost` — populated by the Shippo call.
- `orders.shipped_to_buyer_at` — set on status transition.
- `orders.shipping_address.phone` — the phone column we added in commit `67cc216`. Required by USPS; lookup endpoint will refuse pack-out without it.

## Endpoints

### `POST /api/admin/pack/lookup`

`src/app/api/admin/pack/lookup/route.ts` (new)

Resolves a scanned Product QR into a pack-out preview. Single round-trip so the screen can render the full preview before the operator commits.

**Body:**
```typescript
{
  qr: string  // Product QR contents — for v1, this is the order_item.id UUID
}
```

**Response (200, qualifies for pack-out):**
```typescript
{
  ok: true,
  order: {
    id: string,
    buyer_name: string,
    items: Array<{
      id: string,
      card_name: string,
      condition: string,
      quantity: number,
      image_url: string | null,
    }>,
    shipping_address: ShippingAddress,
    shipping_cost: number,         // quoted at checkout, charged
    item_count: number,
  }
}
```

**Response (200, can't be packed yet — structured reasons):**
```typescript
{
  ok: false,
  reason: 'not_authenticated'
        | 'exception_review'
        | 'already_shipped'
        | 'missing_phone'
        | 'cancelled'
        | 'not_found',
  order_id?: string,         // present except when 'not_found'
  detail?: string,           // human-readable supplemental info
  fixup_url?: string,        // where to go to fix it (auth page, detail page)
  existing_label_url?: string, // present when reason='already_shipped'
}
```

Validation order matters — `not_found` is fastest (DB miss), then status checks, then address checks. Cheapest rejections first.

Admin-only (same `is_admin` check used across the admin API surface).

### `POST /api/admin/pack/ship/[orderId]`

`src/app/api/admin/pack/ship/[orderId]/route.ts` (new)

The commit endpoint. Pre-conditioned the same way lookup is — re-validates because the lookup response may be seconds old and a second operator could have shipped it in between.

**Steps (transactional, rollback-on-failure):**
1. Re-fetch order. Re-check `status='authenticated'`.
2. Call `createOutboundLabel({ ...buyer addr, email: buyerAuthEmail, phone: addr.phone })`. Catch & surface error as 502 with retry guidance.
3. `UPDATE orders SET status='shipped_to_buyer', tracking_number=…, tracking_carrier=…, outbound_label_url=…, outbound_label_cost=…, shipped_to_buyer_at=NOW() WHERE id=? AND status='authenticated'` — the WHERE clause is the lock; 0 rows = 409.
4. Fire `sendBuyerShippedToBuyerEmail` (independent try/catch; failure logged but doesn't roll back the ship).
5. Return `{ ok, label_url, tracking_number, carrier, cost }`.

**Why a separate endpoint instead of reusing `/api/admin/orders/[orderId]/outbound-label` + `/status`:**
- The existing two-call dance is "label first, then flip status." That works for the order detail page where the operator wants the label PDF before committing. On the pack screen the operator scans and ships in one click — re-doing this as two HTTP calls adds latency without value.
- The pack endpoint pre-validates pack-readiness in the lookup endpoint, so the ship endpoint can skip a layer of checks that the legacy endpoints repeat.
- Existing endpoints stay alive — they're still the right tool for "I want to manually print a label and review before flipping status" on the order detail page.

### Print dispatch

Zebra printing is **client-side** — `src/lib/zebra.ts` talks to a local BrowserPrint agent on `localhost:9100`. Intake's product-label flow already uses this for ZPL labels.

The wrinkle for pack-out: Shippo defaults to PDF labels (see `createOutboundLabel` in `src/lib/shippo.ts` — `labelFileType: 'PDF'`). Browsers can't auto-print a cross-origin PDF without user interaction. Two paths:

- **PDF-preview path (status quo)** — the ship endpoint returns the PDF URL; the client opens it in a new tab; the admin clicks the browser's print button. Matches today's order-detail behavior. One extra click per package.
- **ZPL auto-print path (new)** — request `labelFileType: 'ZPL'` from Shippo for the outbound label, send the raw ZPL to the Zebra agent via `printZpl()`. True one-click ship. Requires a new Shippo call signature (label is ZPL string, not URL) and a small change to `createOutboundLabel`. Falls back to PDF if Zebra is offline.

Going with **ZPL auto-print** since the whole point of the new screen is removing clicks. Plumbing: `createOutboundLabel({ ..., format: 'zpl' | 'pdf' })` overload; ship endpoint returns both `zpl` (string) and `label_url` (PDF fallback); client tries `printZpl(zpl)` first, falls back to `window.open(label_url)` if the agent rejects.

When the printer is offline, the client renders "label generated, print failed" with a download button. The order is still `shipped_to_buyer` (the label exists in Shippo; the physical print is recoverable).

## UI

### `/admin/pack` — focus screen

`src/app/admin/pack/page.tsx` (new). Layout follows the same convention as `/admin/authenticate/[orderId]` — full-width inside the admin shell, status banner at the top, large central panel, sticky action bar at the bottom.

Three render states drive the visual:

| State | What's shown |
|---|---|
| `idle` | Big scan input (auto-focused), counter showing today's packed count, recent 5 packed orders for context |
| `loading` | Pulse skeleton (lookup is sub-second but shouldn't flash) |
| `preview` (qualifies) | Buyer name + address card, items grid with thumbnails, shipping cost line, big "Generate + Print Label" button, "Scan another" escape link |
| `preview` (rejected) | Reason chip (red for `cancelled`/`not_found`, amber for `exception_review`/`missing_phone`, blue for `already_shipped`), human-readable explanation, link to the right fixup screen |
| `shipped` | Green check toast + tracking number echo, auto-fades after ~2s, scan input re-focuses |
| `error` | Red banner with the error message, retry button, scan input stays disabled until acknowledged |

### Keyboard

- Scan input auto-focuses on mount and after every successful ship (mirrors intake).
- `Enter` in preview state = trigger Generate + Print Label.
- `Escape` in preview state = abandon, refocus scan input.
- `?` opens a keyboard cheatsheet overlay (planned, not v1).

### Nav

Add a "Pack" entry to the Fulfillment section of `/admin/layout.tsx`, between Intake and Issues. Order top-to-bottom mirrors the package lifecycle: Orders → Intake → Pack → Issues → Risk Review.

## Edge case matrix

| Scenario | Lookup response | UI response |
|---|---|---|
| QR doesn't decode to a UUID | 400 from server | Red toast "Invalid QR — try again" |
| Item exists but order is `paid` / `seller_shipped` / `received` | `reason: 'not_authenticated'` | Show order, link to `/admin/orders/[id]` |
| Order is `exception_review` | `reason: 'exception_review'` | Show order + exception types, link to `/admin/authenticate/[id]` |
| Order is `shipped_to_buyer` already | `reason: 'already_shipped'` + `existing_label_url` | Show "Already shipped on [date]" + "Reprint label" + "View order" |
| Order is `cancelled` / `refunded` | `reason: 'cancelled'` | Show muted "This order was cancelled" with timestamp |
| Buyer address missing phone | `reason: 'missing_phone'` | Inline phone-fixup form, saves via PUT shipping endpoint, retries lookup |
| Shippo errors during ship | 502 from ship endpoint | Red banner with Shippo's error message + "Retry" button |
| Printer offline | Ship succeeded, print failed | Yellow banner "Shipped, but printer offline — download label" |
| Concurrent admin shipped first | 409 from ship endpoint | Red banner "Another admin shipped this order seconds ago" + refresh |

## Activity log

Every successful pack-out writes an `intake_activity_log` row:
```jsonc
{
  order_id: "...",
  action: "packed_out",
  details: {
    tracking_number: "...",
    carrier: "USPS",
    cost: 4.23,
    label_url: "https://...",
  },
  performed_by: <admin uuid>
}
```

Reuses the existing intake log table rather than adding a new one — the audit shape is identical and we'd rather have one timeline view than two.

## Rollout

1. **Ship lookup + ship endpoints** behind no flag (no UI exposes them yet).
2. **Ship the `/admin/pack` page** + add the nav entry. Old order-detail "Print Outbound Label" stays as the alternate path.
3. **Add the daily-counter + recent-packed list** to the idle state once we have a week of data.
4. **Defer:** packing-slip PDF in the box, multi-package outbound, batch mode. All revisitable when volume justifies.

## Open implementation questions

- **Product QR payload format:** Confirmed — `print-label/route.ts` line 45 encodes the raw `order_item.id` UUID directly into the QR (`^FDMA,${orderItemId}^FS`). Triage labels use a `TRIAGE:` prefix. Pack-out lookup needs to: (a) reject `TRIAGE:` prefixed scans with "this is a triage label, not a product", (b) parse the UUID, (c) reject anything else as malformed.
- **Print agent location:** Confirmed — client-side via `src/lib/zebra.ts` → `http://localhost:9100`. Pack screen calls `getPrinterStatus()` on mount (same as intake) to display the printer indicator, calls `printZpl()` after the ship endpoint returns.
- **Reprint-after-shipped flow** — currently lives on the order detail page. Should `/admin/pack` show a "scan to reprint" mode too? Leaning yes (an operator who realizes the printed label is smudged shouldn't have to context-switch), but defer until someone asks.
- **ZPL fallback if Shippo doesn't support it for the chosen carrier:** USPS supports ZPL via Shippo. UPS supports ZPL too. If we ever onboard a carrier that doesn't, the ship endpoint should detect and fall back to PDF gracefully.
