# Credits & Wallet

## Overview

Nomi runs a credit-based wallet alongside Stripe card payments. **1 credit = $1 USD.** Sellers earn credits when their sales pass authentication; buyers can spend credits at checkout in place of (or alongside) a card charge.

The wallet UI lives at `/wallet`. The underlying source of truth is the `credit_transactions` ledger — an append-only table that records every movement of credit in or out of a user's balance. `profiles.balance` is the denormalized running total of *available* credits and is kept in sync with the ledger.

---

## Data Model

### `credit_transactions`

Append-only ledger. One row per credit event.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | UUID → profiles | Whose balance moved |
| `amount` | NUMERIC(10,2) | Positive = credit in, negative = credit out |
| `type` | enum | See types below |
| `order_id` | UUID → orders, nullable | If the event was tied to an order |
| `description` | text, nullable | Human-readable note |
| `metadata` | JSONB | Reserved for future structured detail |
| `created_at` | timestamptz | |

**Constraints:**
- `amount <> 0`
- `amount` sign must match `type`:
  - `sale_earned`, `refund_credit` → positive
  - `purchase_spent`, `cashout` → negative
  - `admin_adjust` → either, but not zero

**RLS:** users can read their own rows. Inserts/updates/deletes happen via the service role only (server routes use `getSupabaseAdmin()`).

### `credit_transaction_type` enum

| Type | Direction | Triggered when |
|---|---|---|
| `sale_earned` | + | Order moves to `authenticated`; seller is credited `subtotal − platform_fee` |
| `purchase_spent` | − | Buyer applies credits at checkout |
| `refund_credit` | + | Credits returned (e.g. superseded checkout) |
| `cashout` | − | Seller withdraws credits to bank (not yet implemented) |
| `admin_adjust` | ± | Manual adjustment, or the $5 shipping-label fee |

### Schema extension: `orders.credits_applied`

`NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (>= 0)` — records how much of an order was paid using credits. The remainder is charged via Stripe.

### `profiles.balance`

Pre-existing column; kept as the denormalized "available credits" running total so that page loads don't need to sum the entire ledger. It must always equal `SUM(credit_transactions.amount)` for that user.

---

## Balance Concepts

The wallet UI distinguishes two numbers:

| | What it represents | How it's computed |
|---|---|---|
| **Available** | Spendable today | `profiles.balance` |
| **Pending** | Sold but not yet authenticated | `SUM(orders.subtotal − orders.platform_fee)` for `seller_id = user` where `status ∈ (paid, seller_shipped, received)` |

Pending credits are **not** in the ledger — they're future events. They flip into the ledger as `sale_earned` (and into `available`) when the order is authenticated.

---

## Seller Earning Flow

```
Order placed → Seller ships → received → AUTHENTICATED → balance += (subtotal − fee)
                                              │              ledger += sale_earned
                                              ▼
                                       seller can spend / cash out
```

Implementation: [src/app/api/admin/orders/[orderId]/status/route.ts](../src/app/api/admin/orders/[orderId]/status/route.ts) — when an admin transitions an order to `authenticated`, the route both updates `profiles.balance` and inserts a `sale_earned` row.

### Shipping fee deduction

When a seller generates a label at [src/app/api/orders/[orderId]/label/route.ts](../src/app/api/orders/[orderId]/label/route.ts), `$5` is deducted from their balance immediately and a `admin_adjust` ledger row is recorded. The platform covers the actual Shippo cost.

**Net seller payout** therefore works out to:

```
subtotal − $5 (label fee) − 9.5% (platform fee)
```

split across two ledger events: `admin_adjust −$5` at ship time, `sale_earned +(subtotal − fee)` at authentication.

---

## Buyer Spending Flow (Pay-with-Credits)

### UX

On the checkout page, if the buyer has any wallet credits, a "Wallet Credits" card appears between Shipping and Payment with an input and Apply / Clear buttons.

- Maximum applicable: `min(balance, subtotal − $1)`
- The $1 floor keeps the Stripe PaymentIntent above their minimum and lets the card step still run.
- For a 100% credit purchase, the buyer would currently still need to put $1 on a card. (Fully card-free fulfillment is a future phase.)

### Mechanics

`POST /api/stripe/payment-intent` accepts an optional `credits_applied` field. On creation:

1. Read `profiles.balance` for the buyer.
2. Clamp `credits_applied` to `min(requested, balance, subtotal − $1)`.
3. **Refund any prior stale pending order's credits** for this listing — for each stale order:
   - Insert `refund_credit +staleCredits` ledger row
   - Add the credits back to `profiles.balance`
   - Mark the order `cancelled`
4. Create the new `orders` row with `credits_applied = N`.
5. Deduct `N` from `profiles.balance` and insert a `purchase_spent −N` ledger row.
6. Create the Stripe PaymentIntent for `subtotal − N` only.

Changing the credit amount while on the checkout page re-runs the route end-to-end (cancel + recreate). The Stripe `<Elements>` component is keyed on `clientSecret` so it remounts cleanly.

### Order display

Both buyer and seller order summaries show the breakdown:

```
Subtotal       $100.00
Wallet credits  -$20.00
Paid on card    $80.00
```

`order.credits_applied` is read on the [order details page](../src/app/orders/[orderId]/page.tsx) for the buyer view; seller payout math is unaffected (sellers receive `subtotal − fee` regardless of how the buyer paid).

---

## Wallet Page

Route: `/wallet` ([src/app/wallet/page.tsx](../src/app/wallet/page.tsx))

Sections:

1. **Available** — `profiles.balance`
2. **Pending** — derived sum across orders in `paid / seller_shipped / received`
3. **Cash out to bank** — disabled placeholder until bank link is built
4. **Recent activity** — last 50 ledger rows for this user, with type label, date, description, and a clickable order link when `order_id` is present

The Settings tab on `/dashboard` links to `/wallet` for entry.

---

## Editing the Ledger Safely

The ledger is meant to be append-only. To preserve auditability:

- **Never UPDATE or DELETE rows** in `credit_transactions`. Issue a compensating row instead (e.g., a `refund_credit` row to reverse a `purchase_spent`).
- **Keep `profiles.balance` in sync.** Any new code path that adds a ledger row must also adjust `profiles.balance` by the same amount, ideally inside the same transaction. Server-side code in this repo does this manually; database-level enforcement (a trigger) is a future improvement.
- **Use `getSupabaseAdmin()` for inserts.** Only the service role can write to the ledger — user JWTs cannot.

---

## Known Gaps

| Gap | Impact | Mitigation today |
|---|---|---|
| Abandoned credits | If a buyer applies credits then closes the tab, those credits sit debited on the pending order until they revisit checkout for that listing. | Cancel/refund path runs whenever the buyer hits checkout again. A scheduled cleanup job would close this fully. |
| 100% credit fulfillment | Not supported; buyer always pays at least $1 on card. | UI surfaces the cap explicitly ("Capped at $X — $Y minimum on card"). |
| Cashout | Disabled in UI. | Requires Stripe Connect Express + Financial Connections (planned). |
| Balance trigger | `profiles.balance` is updated by application code, not a DB trigger. Drift is possible if a future code path forgets to update both. | Reconcile periodically: `SUM(credit_transactions.amount) GROUP BY user_id` should equal `profiles.balance`. |
| `total_sales` counter | Incremented in the authenticate route alongside the ledger insert; not derivable from the ledger alone. | Treat as a denormalized counter; rebuild from `COUNT(orders WHERE status = 'authenticated' AND seller_id = …)` if needed. |

---

## Reconciliation

To check the ledger is internally consistent:

```sql
-- Drift between ledger total and denormalized balance, per user
SELECT
  p.id,
  p.balance AS denormalized,
  COALESCE(SUM(ct.amount), 0) AS ledger_sum,
  p.balance - COALESCE(SUM(ct.amount), 0) AS drift
FROM profiles p
LEFT JOIN credit_transactions ct ON ct.user_id = p.id
GROUP BY p.id, p.balance
HAVING p.balance - COALESCE(SUM(ct.amount), 0) <> 0;
```

A non-empty result means a code path adjusted `profiles.balance` without writing a ledger row (or vice versa). The ledger is authoritative — `profiles.balance` should be updated to match.

**Backfill note:** Users who already had a non-zero `profiles.balance` before this system shipped have no historical ledger rows. The reconciliation query will surface them as drift; backfill with a one-off `admin_adjust` row per user if you need a clean ledger:

```sql
INSERT INTO credit_transactions (user_id, amount, type, description)
SELECT id, balance, 'admin_adjust', 'Opening balance (pre-ledger)'
FROM profiles
WHERE balance <> 0
  AND NOT EXISTS (SELECT 1 FROM credit_transactions WHERE user_id = profiles.id);
```
