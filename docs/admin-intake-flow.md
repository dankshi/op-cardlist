# Admin Intake System

## Overview

When a seller ships cards to our platform, the **intake team** receives, inspects, and verifies every item before we authenticate and forward to the buyer. This document covers the full intake workflow, the tools available, and how issues are triaged.

---

## Order Lifecycle (Where Intake Fits)

```
Buyer places order → Seller ships to platform → INTAKE → Authenticate → Ship to buyer → Delivered
                                                  ▲
                                            (you are here)
```

| Stage | Who | What happens |
|-------|-----|-------------|
| `paid` | Seller | Seller generates shipping label, packs items |
| `seller_shipped` | Seller | Package is in transit to our facility |
| **`received`** | **Intake team** | **Package arrives — items are scanned, verified, or flagged** |
| `authenticated` | Admin | All items verified — seller gets paid, order advances |
| `shipped_to_buyer` | Admin | Platform ships to buyer with tracking |
| `delivered` | Buyer | Buyer confirms receipt, can leave review |

**Key rule:** An order **cannot** be authenticated until every item has been verified or its issues resolved.

---

## Intake Workflow

### Step 1: Scan the Package

1. Go to **`/admin/intake`**
2. The scan input auto-focuses — use the **USB barcode scanner** to scan the QR code on the packing slip, or type/paste the order ID manually
3. The order loads with all its items

### Step 2: Verify Each Item

For each item in the order, compare the physical card against the listing:

- **Card matches?** → Click **"Verify"** (one click, done)
- **Everything matches?** → Click **"Verify All Items"** to batch-verify

### Step 3: Flag Issues

If something is wrong, click **"Flag"** on the item and select the issue type:

| Issue Type | When to use |
|-----------|-------------|
| **Wrong Card** | Seller sent a different card than what was listed |
| **Wrong Condition** | Card condition doesn't match the listing (e.g., listed as NM but card is damaged) |
| **Missing Item** | An item on the order wasn't in the package |
| **Counterfeit** | Card appears to be fake |
| **Damaged in Transit** | Card was damaged during shipping |
| **Wrong Quantity** | Received fewer/more than the listed quantity |
| **Other** | Anything else |

When flagging, you'll fill out:
- **Issue type** (from the list above)
- **Description** (what's wrong)
- **Expected vs. received card** (auto-populated, editable)

### Step 4: Handle Unexpected Items

If the seller sent a card that **isn't on the order**, click **"Add Item"** to create a new item entry under the order. This gets logged in the audit trail.

### Step 5: Track Progress

The intake page shows a progress bar: **"3/5 items verified"**. Once all items are either verified or have resolved issues, the order is ready for authentication.

---

## Resolving Issues

### Issues Dashboard (`/admin/intake/issues`)

All flagged issues across all orders appear here. You can filter by:
- **Status**: Open, In Progress, Escalated, Resolved
- **Type**: Wrong Card, Missing Item, etc.

### Resolution Options

When resolving an issue, the admin picks one of these actions:

| Resolution | What it means |
|-----------|---------------|
| **Request Replacement** | Notify seller to send the correct card — order holds until received |
| **Partial Refund** | Accept what was sent, refund the buyer the difference |
| **Full Refund** | Refund the buyer entirely, return item to seller |
| **Cancel Order** | Cancel the whole order and refund buyer |
| **Accept Item** | Admin decides the item is acceptable (e.g., minor condition disagreement) |
| **Create New Item** | Add a corrected item entry to the order |
| **Contact Seller** | Reach out to the seller for clarification before deciding |

When an issue is resolved, the related item's status automatically updates to **"resolved"**, and the order can proceed.

---

## Packing Slips

When a seller generates a shipping label, they can print a **packing slip** at:

```
/api/orders/{orderId}/packing-slip
```

The packing slip includes:
- **QR code** encoding the order ID (for barcode scanner intake)
- Item checklist (card name, quantity, condition)
- Seller and buyer info
- A "Print" button

---

## Accountability & Audit Trail

Every action during intake is tracked:
- **Who** performed the action (specific admin employee, not generic)
- **What** they did (verified, flagged, resolved, added item)
- **When** it happened
- **Details** (card name, issue type, resolution notes)

This audit trail is visible on the intake page under each order and can be used for:
- Training new intake staff
- Investigating disputes
- Quality control

---

## Admin Panel Integration

The main admin panel (`/admin`) now shows:
- **Intake progress bars** on order cards (e.g., "2/4 verified")
- **Color-coded dots** next to each item (green = verified, red = flagged, blue = resolved, gray = pending)
- The **"Mark Authenticated"** button is **blocked** if any items are pending or flagged — it shows **"Verify Items First"** instead, linking directly to the intake page for that order

---

## Quick Reference

| Page | URL | Purpose |
|------|-----|---------|
| Intake Scanner | `/admin/intake` | Main intake workspace — scan & verify |
| Issues Dashboard | `/admin/intake/issues` | View & resolve all flagged issues |
| Admin Panel | `/admin` | Order management with intake progress |
| Packing Slip | `/api/orders/{id}/packing-slip` | Printable slip with QR code |

---

## Database Tables

| Table | Purpose |
|-------|---------|
| `order_items.intake_status` | Per-item status: pending → verified / flagged → resolved |
| `intake_issues` | Every flagged problem with expected vs received data, resolution tracking |
| `intake_activity_log` | Immutable audit trail of all intake actions |
