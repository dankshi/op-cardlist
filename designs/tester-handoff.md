# Tester Handoff — Admin Flows

> One-page guide for an external tester walking through the admin fulfillment flows on a workstation with the Zebra printer + USB scanner attached.

---

## What you're testing

The full lifecycle a real order goes through inside our warehouse:

```
Seller ships → Intake (receive)
            → Authenticate (per-item Authentic/Fake decisions)
            → Pack (scan to ship outbound)
            → Resolution (when something needed flagging)
```

Four admin screens, all live and wired end-to-end. We've pre-seeded four test orders — one parked at each stage — so you don't have to wait for a real order to advance to the next state. Just scan, click, and ship.

---

## One-time setup

### 1. Hardware

- **Zebra thermal label printer** plugged in via USB.
- **USB barcode scanner** plugged in via USB.
- A workstation running **Chrome or Edge** (Firefox works too but BrowserPrint is best-tested on Chromium).

### 2. Printer setup — two paths

**Path A — Zebra ZD-series printer (ZPL via BrowserPrint):**
- Download the agent: https://www.zebra.com/us/en/support-downloads/printer-software/by-request-software.html
- Run the installer, open the BrowserPrint tray icon, confirm your Zebra is listed and **default**.
- Load **2"×1"** direct-thermal labels for QR stickers; a second printer with **4"×6"** rolls for shipping labels if you have one.
- Admin screens show a green **"Zebra ready"** pill and print instantly, no dialog.

**Path B — any other printer (ZSB DP12, AirPrint, regular inkjet/laser):**
- **You do NOT need BrowserPrint.** Skip Path A entirely.
- Admin screens detect there's no Zebra and switch to **"PDF mode"** automatically — you'll see an amber pill saying so. **This is normal, not an error.**
- When you print a QR label or shipping label, a new browser tab opens with the label and the print dialog fires automatically. Pick your printer + label size, print.
- For the **DP12**: if it's set up as an AirPrint / system printer, it shows up in the print dialog directly. If you only have the ZSB app, save the opened PDF/image and import it into ZSB Designer to print.

Either path works — the system adapts to whatever printer it finds. We'll note where the two differ in the scenarios below.

### 3. Verify the scanner

Open a text editor, click in the body, squeeze the scanner at any barcode in your environment. The scanner should type the decoded contents followed by an Enter. If yes → done. If nothing happens → check the USB connection / driver mode.

### 4. Log in

We've given you an admin account. URL:

```
https://nomimarket.com/admin
```

(Or whatever the dev URL is — Henry will confirm.) Log in with the admin credentials provided separately. You should land on the **admin dashboard** with queue counts and recent activity.

### 5. Confirm the printer indicator

Open `/admin/pack` — there's a printer pill in the header.
- **Green "Zebra ready"** → Path A, labels print directly.
- **Amber "PDF mode"** → Path B, labels open as a printable PDF. **This is expected if you're not on a Zebra — not a problem.**

---

## Test orders (already seeded)

We've pre-created 4 orders, one parked at each stage. Henry will share the order IDs separately — they look like `#abc12345`. Throughout this guide we'll reference them as:

| | Scenario | Status | What you'll test |
|---|---|---|---|
| **A** | Seller shipped | `seller_shipped` | Intake (receive the package, print Product QR labels) |
| **B** | Received | `received` | Authentication (per-item Authentic/Fake decisions) |
| **C** | Authenticated | `authenticated` | Pack-out (scan to ship) |
| **D** | Exception review | `exception_review` | Resolution (refund + cancel + relist) |

You can also see all four at `/admin/orders` — they'll be grouped by status.

---

## Scenario A — Intake

> **Goal:** receive a package physically arrived from a seller, mark it received, print Product QR stickers for every card so the rest of the warehouse flow can find them.

1. Go to **`/admin/intake`**. The scan input is auto-focused.
2. Find the tracking number for Order A — Henry will give it to you, or look it up from `/admin/orders/[A's id]` under "Inbound — Seller to Platform".
3. **Scan or paste** the tracking number into the input and hit Enter. The screen should switch to "Order Found".
4. Verify the order details look right (buyer name, items list).
5. Click **"Receive Package & Print Labels"**. Two things should happen:
   - The order's status flips to `received` (you'll see this on the order detail page).
   - **Path A (Zebra):** one Product QR sticker prints for each item, instantly.
   - **Path B (DP12/other):** a new tab opens with all the QR labels + the print dialog. Pick your printer and label size, print.
6. Pick up the printed stickers/labels. Each has a QR code + the card name + order ID. Stick one on a physical card (any card — a real card from a binder works, or a printed mockup).
7. Move on to Scenario B with the labels in hand.

**Expected:** Order A is now in `received` status. Labels are printed and stuck on cards.

**If it fails:**
- Nothing printed on Path A — re-check BrowserPrint is running, or just let it fall back (it should open the PDF tab if no Zebra is found).
- "Order not found" — paste the order's UUID instead of the tracking number.
- Tell Henry exactly what error appeared.

---

## Scenario B — Authentication

> **Goal:** make per-item decisions on a received order. Mark some Authentic + Near Mint (clean pass) and flag at least one as a Fake or Exception to verify the branching flow.

1. Go to **`/admin/orders/[B's id]`** (or click order B from the orders list).
2. Click **"Start Authentication →"**. This opens the dedicated `/admin/authenticate` GOAT-style page.
3. The first item is highlighted on the left. The decision controls are in the center.
4. **Test the clean path** on the first item:
   - Press `A` (or click "Authentic")
   - Press `N` (or click "Near Mint")
   - Press Enter (saves the decision + advances)
5. If the order has multiple items, **test the exception path** on the second:
   - Press `A` for Authentic
   - Press `E` for Exception
   - In the right pane, click "Conditional"
   - Pick "Lightly Played" + check "corners"
   - Press Enter
6. Continue until every item has a decision.
7. Click **"Finalize Authentication"** at the bottom.
8. Watch where the order lands:
   - All items clean → status flips to `authenticated`
   - Any exception → status flips to `exception_review`

**Expected:**
- Order B's status flips to either `authenticated` or `exception_review`.
- Buyer + seller emails fire (check Resend dashboard or seed buyer's inbox).
- Slack ping fires for exception_review (if `SLACK_WEBHOOK_URL` is configured).

**Also worth testing:** press `F` on an item to mark Fake. The right pane should show a "Destroy / Return to seller" picker. The disposition you pick determines what the email tells the seller.

---

## Scenario C — Pack out

> **Goal:** scan a Product QR sticker → ship the order → label prints → packing slip prints.

This requires that Scenario A was completed (you should have a physical card with a Product QR sticker stuck to it from order A — but A is now in `received`, not `authenticated`, so for pack you'll either:
- Walk Order A through Scenario B too (full clean pass) so it lands in `authenticated`, then pack it; OR
- Use the pre-seeded Order C — go to `/admin/orders/[C's id]` and click **"Print Labels"** at the top of the items section. That reprints fresh QR stickers for Order C; stick one on a card.

1. Go to **`/admin/pack`**. The scan input is auto-focused. Printer pill shows green "Zebra ready" or amber "PDF mode" — either is fine.
2. Squeeze the scanner at the QR sticker.
3. The lookup fires automatically. A preview card appears with:
   - Buyer name + shipping address
   - List of items in the order
   - The card you scanned is highlighted with an orange ring
4. Verify it's the right order, then click **"Generate + Print Label"** (or press Enter).
5. **What should happen, in order:**
   - Shipping label: **Path A (Zebra)** prints directly; **Path B (DP12/other)** opens the 4"×6" label PDF in a new tab with the print dialog
   - Order's status flips to `shipped_to_buyer`
   - A second new tab opens with the buyer-facing packing slip → print dialog pops automatically
   - Pack screen shows "Shipped ✓" with carrier + tracking
   - After ~2.5 seconds, screen auto-resets for next scan
   - (On Path B you'll get two print dialogs — one for the shipping label, one for the packing slip. That's expected.)
6. Print the packing slip (Cmd+P or click Print in the print dialog).
7. Confirm the buyer receives the "your card has shipped" email.

**Expected:**
- Shipping label has the right buyer address, tracking number stored on the order.
- Packing slip is buyer-facing (says "Hey [FirstName] 👋", has 14-day return policy + authenticated stamp).
- Order can now be searched in `/admin/orders` under "Shipped to Buyer".

**Edge case to try:** rescan the same QR after shipping. You should get a blue **"Already shipped"** card with a "Reprint label" link.

---

## Scenario D — Exception resolution

> **Goal:** close out an `exception_review` order. Set the consignment relist price, refund the buyer, cancel the order.

1. Go to **`/admin/orders/[D's id]`**. The order is in `exception_review` with one item flagged as Conditional (Lightly Played downgrade).
2. Scroll down to the amber **"Exception resolution"** panel.
3. In the per-item row:
   - **"Consignment relist price"** input — put a price like `40.00` (we'll relist this card at that price)
   - Optional notes — try "Test resolution from tester cohort"
4. Click **"Refund + Cancel Order"**. Confirm the prompt.
5. **What should happen:**
   - Order's status flips to `cancelled`
   - The buyer's wallet balance increases by the order total
   - The buyer gets a "Refund processed — $X to wallet" email
   - The `consigned_intakes` row gets the relist price stamped on it (visible at `/admin/inventory`)

**Then verify the consignment side:**
6. Go to **`/admin/inventory`**. The Consignment tab should show the resolved row from order D with your price.
7. Click **"Mark Listed"** to advance it through the lifecycle (then **"Mark Sold"** if you want).

**Expected:**
- Order D's status: `cancelled`
- Buyer's wallet: credited
- Consignment row: `pending_relist` → `listed` → `sold` as you advance it

---

## Quick sanity checks

After running all four scenarios, glance at these:

- **`/admin`** — the dashboard should show your day's activity in the recent feed: receive, authenticate, pack, resolve. Today's counters should be non-zero.
- **`/admin/orders`** — orders should be in their new statuses: A in received (or further if you Scenario B'd it), B in authenticated/exception_review, C in shipped_to_buyer, D in cancelled.
- **`/admin/inventory`** — the consignment row from Scenario D should appear with whatever lifecycle stage you left it at.
- **Resend dashboard** (if you have access) — should show buyer/seller emails for each scenario.

---

## What to report back

After your run, for each scenario tell us:

1. **Did it work end-to-end?** Plain yes/no per scenario A/B/C/D.
2. **Anything visually off?** Buttons in weird spots, copy that didn't make sense, scrollbars where you didn't expect them.
3. **Anything that felt slow?** Especially scan → preview latency on `/admin/pack`, or finalize → status flip on `/admin/authenticate`.
4. **Anything that errored?** Screenshot + the order ID is plenty.
5. **One thing that surprised you** (good or bad).

Send to Henry. Thanks for testing 🙏

---

## If you need to start fresh

Henry can re-seed the cohort by running `npx tsx scripts/seed-tester-cohort.ts` from the repo root. The script is idempotent — re-running only creates orders that don't exist; previously-seeded orders stay put.

---

*Last updated: 2026-05-25. Hardware setup details: [designs/packing-flow.md § Hardware + setup](./packing-flow.md#hardware--setup). Full state machine: [docs/authentication-flow.md](../docs/authentication-flow.md).*
