# Packing Flow — Design Summary

> Human-readable version for sharing with stakeholders, partners, or pasting into Google Docs. Decision-and-rationale only; for the technical implementation see [docs/packing-flow.md](../docs/packing-flow.md).

---

## What we're building

A dedicated **Pack Out** screen for the admin, matching the muscle memory of the Intake and Authentication screens. The flow is dead simple: scan the product QR code on a card → the screen pulls up the order + buyer address → click Print → the outbound shipping label fires to the Zebra printer → the order automatically moves to `shipped_to_buyer` and the buyer gets the "your card has shipped" email with tracking.

No clicking through `/admin/orders/[orderId]` to find the right order. No manually flipping the status. One screen, one scan, one print, one packing tape pull, one box out the door.

---

## Why this is worth doing

**1. Packing is the per-piece bottleneck.** Intake is roughly fixed-cost per *package* (scan tracking, dump cards). Pack-out is variable per *order* — every shipment needs the admin to find the order, verify the items match, generate the label, print it, attach it, drop in the box. At volume this is where the time goes. A scan-driven screen turns a 90-second click-through into a 5-second action.

**2. The QR code we already print at intake is the right anchor.** Every item gets a Product QR label at the intake step ([admin-intake-flow.md](./../docs/admin-intake-flow.md)). The QR encodes the order item ID. Pack-out reuses it — scan the same label you stuck on the toploader when the card came in, and the system knows exactly which order to pack.

**3. Pairs naturally with the rest of the warehouse flow.** Intake = scan tracking. Authentication = scan product QR. Pack-out = scan product QR. Every step in the warehouse is "go to one screen, scan, act." Operator never has to navigate by hand mid-shift.

**4. The current state silently lets bad things happen.** Today the admin clicks "Mark Shipped to Buyer" on the order detail page, which auto-generates the label. If that label generation fails, the order used to silently progress without tracking. We fixed the silent-failure recently, but the UX still requires the admin to *find* the right order in the first place. Scan-driven removes the human navigation step entirely — you can't pack the wrong order if the system identified the order from the QR.

---

## How we're doing it

### The flow

```
       ┌─────────────────────────────────┐
       │   /admin/pack — focus screen    │
       │                                 │
       │   [scan product QR input]       │
       │                                 │
       └────────────┬────────────────────┘
                    │  scan a Product QR label
                    ▼
       ┌─────────────────────────────────┐
       │   Lookup order by item ID       │
       │                                 │
       │   • Order status = authenticated│ ← must be this
       │   • All items authenticated     │
       │   • Buyer address has phone     │
       │   • No outstanding exceptions   │
       └────────────┬────────────────────┘
                    │
        ┌───────────┴────────────┐
        │                        │
   qualifies                not qualifies
        │                        │
        ▼                        ▼
┌──────────────────┐   ┌──────────────────────┐
│  Show order      │   │  Show reason it      │
│  preview:        │   │  can't ship:         │
│   • buyer name   │   │   • already shipped  │
│   • items list   │   │   • not authenticated│
│   • destination  │   │   • exception_review │
│   • ship cost    │   │   • missing phone    │
│  [Generate +     │   │  with link to fix    │
│   Print Label]   │   │                      │
└─────────┬────────┘   └──────────────────────┘
          │
          │  one click
          ▼
┌──────────────────────────────┐
│  • Call Shippo for label     │
│  • Save tracking + label URL │
│  • Update status →           │
│    shipped_to_buyer          │
│  • Print label to Zebra      │
│  • Send buyer email          │
│                              │
│  Show "Shipped ✓" toast      │
│  Auto-reset scanner          │
└──────────────┬───────────────┘
               │  scanner re-focuses
               ▼
       (ready for next scan)
```

### What changes for each persona

**Admin / ops** — opens `/admin/pack`, the input is auto-focused. Scans the QR sticker on the card. Sees a clean preview: who it's going to, what's in the order, the label cost. One click prints + ships. The screen resets for the next scan. Total time per package: under 10 seconds for the common path. Compares to the current ~90 seconds (find order in list, open detail page, scroll to find the action button, click, wait, click, navigate back).

**Buyer** — no change to the touchpoint they see (the existing "your card has shipped" email already fires from the status transition). But the *speed* changes — orders that used to wait until the admin got around to clicking through the order list now ship as soon as the package is physically ready.

**Seller** — same as before. Their payout was already credited at authentication; pack-out doesn't move money.

---

## Key design decisions

### Why scan the Product QR (not the tracking, not the order ID)

The Product QR is the physical anchor that's already on the card. The intake team prints and applies it the moment the card arrives. By pack-out time, every card in the warehouse has its QR sticker on the toploader. Scanning that same label closes a clean loop:

- **Intake** prints it, stamps "this card is in our system."
- **Authentication** scans it (eventually — see [authentication-flow.md](./authentication-flow.md)) to load the right item.
- **Pack-out** scans it to ship the order it belongs to.

Tracking numbers identify *packages from the seller* (irrelevant at pack-out — that package has been broken up across many outbound shipments). Order IDs are typed manually = friction. Product QR wins on both counts.

### Why one scan = ship the whole order, not just one item

In our model, all items in an order ship together to the buyer in one outbound package. A buyer can't have part of their order. So scanning *any* item's QR is enough to identify the order — and the act of scanning implicitly confirms "yes, this is the package I'm about to put in the box."

If we ever ship multi-package outbound (which would be a real change — Nomi today is single-package-per-order), we'd revisit this.

### Why we don't show every item's QR for confirmation

We considered: "scan all N items in the order before allowing print." Argument for: prevents shipping with a missing card. Argument against: every item was already verified at the **authentication** step (per-item Authentic/Fake/Near Mint), and is supposed to be physically grouped with the others before pack-out. Re-confirming at pack-out is theater — the actual integrity gate is upstream.

We'll add an optional "verify all items" mode later if we ever miss items in shipments. For v1, one scan is enough.

### Why auto-print to Zebra instead of opening the PDF

The intake flow already prints product labels directly to the Zebra without opening a PDF preview. Pack-out should match — opening a PDF, hitting File→Print, picking the printer adds ~10 seconds and a click-failure risk per package. Direct-to-Zebra via the existing print agent makes the action feel instant.

The PDF stays accessible via the order detail page for reprints, audits, and the rare case where the warehouse printer is offline and the admin needs to send it to a regular laser.

### Why we don't queue / batch

Each scan handles one order end-to-end. No "scan five packages then print all five labels in a batch." Reasons:

- Batch failures are catastrophic — if Shippo errors mid-batch the admin doesn't know which labels succeeded.
- The savings are small at our volume. Saving 2 seconds per package × 50 packages/day = 100 seconds. Not worth the failure modes.
- Synchronous "scan → print → next" matches how a packer's hands actually move — they scan, grab tape, seal, drop in box, then scan the next one. The screen waits for them, not the other way around.

If we ever cross 500 packages/day, revisit.

---

## What gets caught vs what doesn't

**Atomic guarantees:**

- Order can't be packed twice. The status transition (`authenticated → shipped_to_buyer`) is the lock; a second scan of the same QR returns "already shipped" with a re-print option for the existing label.
- Label generation failure holds the status flip — already enforced in the existing `status/route.ts` (returns 502 with retry guidance). Pack-out screen surfaces the same error inline.
- Concurrent scans of the same order by two admins: second one gets the "already shipped" response.

**Failures we handle:**

- **Order not authenticated yet** — screen shows the order, the verdict, and a link to `/admin/authenticate/[orderId]` to finish.
- **Order in exception_review** — screen shows the exception type(s) + a link to `/admin/orders/[orderId]` to resolve.
- **Buyer phone missing** — surfaces a fixup form to add a phone (saves to `shipping_address.phone`) without leaving the screen.
- **Shippo down** — screen shows "carrier unreachable, retry in a moment" and re-focuses the input. No silent failure.
- **Printer offline** — screen shows "label generated but printer offline" + a download-PDF link. Status still transitions (the label exists; physical print is recoverable).

**Edge cases we knowingly don't handle (yet):**

- **Reprint after status transition** — handled on the order detail page, not on `/admin/pack`. Pack-out's job is "ship this." Once shipped, re-prints live with the rest of the order admin tools.
- **Partial shipments** — single package per order is the only mode in v1. Splitting would require schema work + buyer-side tracking-list UI.
- **Pickup at warehouse** — no in-person pickup option. Everything ships.

---

## What this costs us

- **Engineering time:** ~2 days. New screen, one new endpoint (`POST /api/admin/pack/lookup`), reuse of the existing outbound-label and status-transition endpoints.
- **No new infrastructure.** Reuses Shippo, Zebra, the existing `outbound_label_url`/`tracking_number` columns.
- **No new vendor cost.** The label generation cost was already happening, just initiated from a different screen.

---

## What this saves us

- **~80 seconds per outbound package** of admin time. At 20 packages/day that's ~25 minutes/day. At 100 packages/day it's 2+ hours/day.
- **One class of "I shipped the wrong order" errors** — scan-driven means the system identifies the order from the physical thing in your hand, not from a list lookup.
- **A retraining problem.** New ops onboards faster when every warehouse action is "go to a screen, scan, act." Intake → Authenticate → Pack uses the same shape; the shape transfers.

---

## What success looks like

- **Adoption:** Within 1 week of shipping, >90% of outbound labels are generated from `/admin/pack` (rather than the order detail page).
- **Speed:** Median time from scan to "Shipped ✓" toast under 4 seconds (Shippo round trip dominates).
- **Errors:** Under 1 mis-shipped order per 100 packages (current rate is unmeasured but anecdotally non-zero with the manual flow).
- **Failure recovery:** Every Shippo / printer failure produces an actionable on-screen message; admin never has to look at server logs to know what went wrong.

---

## What this is *not*

- **Not a replacement for the order detail page.** Pack-out is for the happy path "ship this now." Detail page stays for everything else (status history, notes, refunds, reprints, fraud review).
- **Not a multi-package picker.** One scan = one order = one label.
- **Not a forecast tool.** It doesn't show "you have 12 orders to pack today." That belongs on `/admin/orders` (already grouped by status). Pack-out is hands-on action only.
- **Not for inbound.** Inbound (seller → Nomi) is the **Intake** screen. Pack-out is outbound (Nomi → buyer) exclusively.

---

## Hardware + setup

### Printer

We use a **Zebra thermal label printer** (direct thermal — no ink, no toner; the label paper is heat-reactive). The code in `src/lib/zebra.ts` talks to the printer via **Zebra BrowserPrint**, a free agent app that runs on the workstation and exposes a JSON API on `http://localhost:9100`. Our browser pages POST raw ZPL command strings to that endpoint; the agent forwards to the USB-connected printer.

**Why BrowserPrint and not a print driver:**
- No driver install per machine
- No "system print dialog" interruption — labels go straight to the printer
- Same code path on Mac and Windows
- Lets us send raw ZPL (Zebra's native language) instead of converting to PDF first

**Recommended printer models (any will work, in price order):**

| Model | Price | Notes |
|---|---|---|
| Zebra ZD220 / ZD230 | ~$200 | Budget desktop. Fine for QR stickers. |
| Zebra ZD421 | ~$400 | Better build, faster, USB + Ethernet. Can handle both QR and shipping labels with a roll swap. |
| Zebra ZD620 | ~$600 | Adds Bluetooth + Wi-Fi if you don't want it tethered to a workstation. |

**Two printers, not one (recommended for production):**
QR labels and shipping labels are different sizes (2"×1" vs 4"×6"). You *can* swap rolls on one printer, but it's slow and error-prone at volume. Most marketplaces use **two printers**: one always loaded with QR stock for intake, one always loaded with 4"×6" stock for shipping. The BrowserPrint agent supports multiple devices simultaneously — we currently call `getDefaultPrinter()` which picks the one marked default. A small follow-up (`printerHint: 'qr' | 'shipping'`) routes each label to the right machine when both are connected.

### Scanner

Any **USB barcode scanner that reads 2D codes** (QR, DataMatrix). They act as keyboard-emulation devices — plug in via USB, no drivers, no setup. When triggered, the scanner "types" the decoded contents followed by Enter into whatever input is focused.

Our screens (`/admin/intake`, `/admin/authenticate`, `/admin/pack`) all auto-focus the scan input on mount. So the operator's loop is just: pick up next package → squeeze scanner → screen reacts.

**Recommended scanner models:**

| Model | Price | Notes |
|---|---|---|
| Generic USB QR scanner (Amazon) | $20–40 | Fine for indoor sticker-density QR. Wired only. |
| Tera Pro 5100 | ~$50 | Wireless dongle, popular indie-warehouse pick. |
| Honeywell Voyager 1450g | ~$150 | Wired, rugged, what big warehouses run. |

### One-time setup (per workstation)

1. Install **Zebra BrowserPrint**: https://www.zebra.com/us/en/support-downloads/printer-software/by-request-software.html — download the agent installer for your OS, run it, accept defaults.
2. Plug the Zebra printer in via USB. The BrowserPrint settings UI (a tray icon menu) lets you set the default device.
3. Load a roll of 2"×1" direct-thermal labels (for QR) — most rolls come pre-loaded for the printer's spindle.
4. Plug the USB scanner in — no install. Trigger it at any text field to confirm it types.
5. Open the admin app in Chrome or Edge. The Pack/Intake/Authenticate pages show a green "Printer ready" pill when the agent + printer are reachable.

### Ongoing management

- **Printer offline:** the pill flips to amber "Printer offline" and labels fall back to PDF preview. Most common causes: agent not running (relaunch from tray), USB unplugged, paper jam.
- **Wrong size labels loaded:** ZPL is layout-relative — printing a 2"×1" template on a 4"×6" roll just leaves blank space. Templates are defined in `print-label/route.ts` (intake) and Shippo (outbound).
- **Multiple workstations:** every workstation needs its own BrowserPrint agent + USB printer. The agent is per-machine; no networked configuration.

---

## How to test the pack flow end-to-end

These steps validate the full loop on a real dev machine. Read these before you have hardware connected — most steps work without hardware (the ship still succeeds, just no physical print).

### Without hardware (dev / desk testing)

1. **Get an order to `authenticated` status.** Easiest: take any existing order and walk it through:
   - `/admin/intake` to receive (need it in `seller_shipped` to start)
   - `/admin/authenticate/[orderId]` to mark items Authentic + Near Mint → Finalize
2. **Grab the order_item ID** for any item — from `/admin/orders/[orderId]` URL or by inspecting the database. It's a UUID.
3. **Open `/admin/pack`** — scan input is auto-focused.
4. **Paste the order_item UUID into the scan input and press Enter.** The lookup fires, the preview card appears with buyer name, items, address, shipping cost. The scanned item gets an orange ring.
5. **Click "Generate + Print Label" (or press Enter).** Shippo generates the label, order flips to `shipped_to_buyer`, you see the green "Shipped ✓" confirmation. Since there's no Zebra agent on your dev machine, you'll see "label generated but auto-print failed" with an "Open label PDF" link — click to verify the PDF rendered correctly.
6. **Confirm the database side:** the order should now have `tracking_number`, `tracking_carrier`, `outbound_label_url`, `outbound_label_cost`, and `shipped_to_buyer_at`. An `intake_activity_log` row with `action='packed_out'` should exist.
7. **Confirm the buyer email fired:** check the Resend dashboard or the buyer's inbox.

### With hardware (real-warehouse testing)

Same as above, but with the BrowserPrint agent installed and a Zebra printer plugged in:

1. **Print Product QR stickers for the items** — use the new "Print Labels" link on `/admin/orders/[orderId]` to re-print stickers any time. (Or run through the intake flow which prints them automatically when receiving the package.)
2. **Stick the QR labels on the cards.**
3. **Open `/admin/pack`** — confirm the "Printer ready" pill is green.
4. **Squeeze the scanner at a sticker.** The QR contents type into the input, the lookup fires automatically (Enter is appended by the scanner).
5. **Confirm the preview shows the right buyer + items.**
6. **Click "Generate + Print Label" or press Enter.** The shipping label should print directly to your Zebra. The green "Shipped ✓" should appear, then auto-reset after ~2.5 seconds to ready for the next scan.

### Edge cases worth verifying

| Scenario | Setup | Expected |
|---|---|---|
| Already-shipped order | Re-scan a sticker for an order you just packed | Blue "Already shipped" card with reprint-label link |
| Order in `exception_review` | Walk one through auth flagging a Fake or Wrong Card | Amber card with "Open authentication" link |
| Order in `received` (not yet authenticated) | Pack-scan a freshly-received order | Amber card with "Open authentication" link |
| Missing phone | Set `orders.shipping_address.phone` to NULL via SQL for a test order | Amber card with "Open order" fixup link |
| Invalid QR | Type "not-a-uuid" into the input | Red "QR scan unreadable" message |
| Triage QR | Stick a triage label by mistake | Red "This is a triage label, not a product" |
| Cancelled order | Cancel an authenticated order via SQL, then pack-scan | Gray "Order is cancelled" card |
| Concurrent ship | Open two browser tabs, scan the same sticker, click Ship in both | First wins; second gets red "Another admin shipped this order seconds ago" |

---

## Decisions locked (2026-05-25)

- **Pack queue counter in header — yes.** "12 orders ready to pack" lives in the screen header so ambient throughput awareness is always visible. Doesn't clutter the central single-purpose action because it's chrome, not content.
- **Packing slip in box — yes (defer to v2).** Mirrors GOAT/StockX. Reduces "I got the wrong card" disputes. Adds a second print step at pack time. Building the core ship flow first; packing slip slots in once the scan-print loop is solid.
- **No auto-print on scan — confirm click stays.** Keeps the "is this the right buyer" sanity check. The one click is cheap compared to a mis-shipped order.

---

*Last updated: 2026-05-25. Live state machine and code paths: see [docs/packing-flow.md](../docs/packing-flow.md).*
