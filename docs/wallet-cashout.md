# Wallet Cashout

Technical reference for the bank-cashout side of the wallet (Stripe Connect Express + cashouts table). For the user-facing wallet model see [credits-and-wallet.md](./credits-and-wallet.md).

## TL;DR

Any user with a wallet balance can connect a bank account (Stripe Express onboarding) and withdraw their credits to it. Two speeds: **standard** ACH (free, 1-3 business days) and **instant** ($1 fee, minutes). Money moves in two hops: platform → connected account (Stripe Transfer) → bank (Stripe Payout).

## Schema

`supabase/migrations/20260601_add_profile_balance_and_cashouts.sql`

### `profiles.balance` (added)

`NUMERIC(10,2) NOT NULL DEFAULT 0` with `balance >= 0` check. **This column was referenced by the credit-ledger code since `20260511_credit_ledger.sql` but never actually existed in any migration** — production almost certainly had it added by hand. The migration adds it with `IF NOT EXISTS` and backfills from `SUM(credit_transactions.amount)` for any zero rows.

### `cashouts`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK profiles | ON DELETE CASCADE |
| `amount` | NUMERIC(10,2) | What hits the bank |
| `fee` | NUMERIC(10,2) | $1 instant, $0 standard. Service revenue. |
| `total_debited` | NUMERIC(10,2) | `amount + fee`. CHECK enforces this. |
| `method` | `payout_method` enum | `standard` \| `instant` |
| `status` | `cashout_status` enum | `pending` \| `paid` \| `failed` \| `cancelled` |
| `stripe_transfer_id` | TEXT | Platform → connected account transfer |
| `stripe_payout_id` | TEXT | Connected account → bank payout (only set for instant) |
| `failure_reason` | TEXT | From `payout.failed` webhook |
| `credit_transaction_id` | UUID FK | The negative ledger row that debited the wallet |
| `requested_at` | TIMESTAMPTZ | |
| `completed_at` | TIMESTAMPTZ | Set when `paid` or `failed` |

Constraints: `amount > 0`, `fee >= 0`, `total_debited = amount + fee`, `amount >= 10`.

RLS: users SELECT own; inserts/updates via service role only.

### `increment_balance(user_id, amount)` RPC

`SECURITY DEFINER` SQL function that atomically increments `profiles.balance`. Used by the `payout.failed` webhook to restore funds race-safely. Service-role only.

## Endpoints

### `POST /api/stripe/connect`

`src/app/api/stripe/connect/route.ts`

Stripe Express onboarding. Used by two intents:
- `intent: 'seller'` — seller flow, returns to `/seller/onboarding/complete`
- `intent: 'wallet'` — wallet cashout flow, returns to `/wallet/onboarding/complete`

Idempotent on `profiles.stripe_account_id`. Gated on (approved seller) OR (balance > 0) — keeps random $0 users out of Stripe's KYC queue.

Only requests the `transfers` capability. `card_payments` was dropped because all buyer payments go to the platform Stripe account, not the connected account (`payment-intent` route doesn't set `transfer_data`/`on_behalf_of`).

### `GET /api/wallet/connect-status`

`src/app/api/wallet/connect-status/route.ts`

Returns `{ connected, payoutsEnabled, detailsSubmitted }`. Always asks Stripe directly (`accounts.retrieve`) rather than trusting `profiles.stripe_onboarding_complete`, because the cached flag can lag the `account.updated` webhook. Side-effect: syncs the cached flag with whatever Stripe says.

Falls back to the cached flag on Stripe API failure so a Stripe outage doesn't block the wallet UI.

### `POST /api/wallet/cashout`

`src/app/api/wallet/cashout/route.ts`

Body: `{ amount: number, method: 'standard' | 'instant' }`.

Flow:
1. Validate via `validateCashoutRequest()` (`src/lib/cashout.ts`) — amount ≥ $10, method valid, `amount + fee ≤ balance`.
2. Re-confirm payouts-enabled by calling Stripe directly. The cached flag is not trusted here because a stale flag would cause a server-side Stripe failure and force a rollback.
3. **Atomic debit**: `UPDATE profiles SET balance = balance - $total WHERE id = $id AND balance >= $total`. 0 rows = concurrent cashout drained the wallet → 409.
4. Insert canonical `credit_transactions` row (`type='cashout'`, negative amount).
5. Insert `cashouts` row (`status='pending'`).
6. `stripe.transfers.create({ destination: stripe_account_id, amount, metadata: { cashout_id } })`.
7. For `instant`, additionally call `stripe.payouts.create({ method: 'instant' }, { stripeAccount })` on the connected account. If the *instant* payout fails (account not instant-eligible), the **transfer is left in place** — funds will ride out on the default daily schedule — and the $1 fee is refunded via a compensating `refund_credit` ledger row.
8. If the transfer itself fails, rollback fully: restore balance, write a `refund_credit` row, mark cashout `failed`.

Returns `{ success, cashout: { id, amount, fee, total_debited, method, status: 'pending' } }`.

### Webhook handlers

`src/app/api/stripe/webhooks/route.ts`

Three new cases added:

#### `account.updated`

Mirrors `account.details_submitted && account.payouts_enabled` into `profiles.stripe_onboarding_complete`. **Pre this handler the flag was never written by any code path** — `/seller/onboarding/complete` would only flip if someone updated the row manually.

#### `payout.paid`

Looks up the cashout row in two ways:
1. **Instant**: matches by `stripe_payout_id` (set when we created the payout).
2. **Standard**: matches by `user_id` (resolved from `event.account` → `profiles.stripe_account_id`) + `status='pending'` + `method='standard'`. Stripe batches multiple transfers into one daily payout for standard cashouts; the payout has no inherent link back to individual cashouts. Pragmatic v1: when an account's daily payout lands, mark all pending standard cashouts for that account as paid. Edge case: if a user requests a cashout and Stripe's daily payout fires before the transfer settles into the next batch, the cashout might be matched against an unrelated payout. Bounded blast radius — admin can see the cashouts table to reconcile.

#### `payout.failed`

Restores balance via `increment_balance()` RPC + writes a `refund_credit` ledger row + marks cashout `failed` with `failure_reason`.

## Money math

For a $50 cashout:

| Method | What user receives | Fee | Debited from balance |
|---|---|---|---|
| Standard | $50.00 | $0.00 | $50.00 |
| Instant | $50.00 | $1.00 | $51.00 |

The $1 instant fee covers Stripe's ~1% instant payout cost (~$0.50 on $50) plus a small margin. It stays in the platform Stripe balance — there's no separate ledger row for it; the asymmetry is captured by debiting `amount + fee` while transferring only `amount`.

## Pure helpers

`src/lib/cashout.ts` — `validateCashoutRequest()`, `quoteCashout()`, `CASHOUT_MIN_AMOUNT=10`, `INSTANT_PAYOUT_FEE=1`. Pure functions; share the same math between the route, the `CashoutModal` live preview, and tests.

`src/lib/cashout.test.ts` covers the validator end-to-end (15 cases).

## Pending-credits formula (wallet UI)

`src/app/wallet/page.tsx:69-77` now mirrors `src/app/api/admin/orders/[orderId]/status/route.ts:110-115`:

```ts
const credit = isLegacy
  ? subtotal - platform_fee - 5
  : subtotal - platform_fee - processing_fee
```

The previous formula `subtotal - platform_fee` over-promised by ~3% on tier-aware orders (it ignored `processing_fee`).

## Stripe webhook events required

The wallet flow needs these three events subscribed at https://dashboard.stripe.com/webhooks (in addition to whatever already subscribed for the order flow):

- `account.updated`
- `payout.paid`
- `payout.failed`

Both *Account* events and *Connect* events need to fire — when adding the webhook endpoint, choose **"Events on Connected accounts"** for `payout.paid`/`payout.failed` (they fire on the connected account, not the platform).

### ⚠️ Production setup — NOT YET DONE

As of 2026-05-24, the live Stripe account has **no production webhook destination** for the three events above. Only the local `stripe listen` CLI session is wired up (good for dev, useless for prod).

**Before shipping cashout to users, do this in the Stripe Dashboard → Webhooks:**

1. Click **"+ Add destination"** (sandbox first to test, then repeat for live mode)
2. **Type:** Webhook endpoint
3. **URL:** `https://<prod-domain>/api/stripe/webhooks`
4. **Events on your account** — `account.updated` (plus everything the existing order-flow endpoint already had: `payment_intent.succeeded`, `checkout.session.completed`, `review.opened`, `review.closed`, `radar.early_fraud_warning.created`, `charge.dispute.created`)
5. **Events on Connected accounts** (separate section, easy to miss) — `payout.paid`, `payout.failed`
6. Save, copy the **signing secret**, set it as `STRIPE_WEBHOOK_SECRET` in prod env.

Until this is done in production:
- Sellers' `stripe_onboarding_complete` flag never flips to `true` after Stripe Express onboarding completes (the `account.updated` handler never fires).
- Standard cashouts will sit in `pending` forever in the `cashouts` table even after the bank receives the funds (the `payout.paid` handler never fires).
- Failed payouts will leave the user's wallet permanently debited with no auto-recovery (the `payout.failed` handler never fires).

For local dev: `stripe listen --forward-to localhost:3000/api/stripe/webhooks --forward-connect-to localhost:3000/api/stripe/webhooks` — the `--forward-connect-to` flag is required for Connect-account events (`payout.*`), otherwise the CLI silently drops them.

## UI components

- `src/app/wallet/page.tsx` — wallet page, three-state cashout card, cashouts list
- `src/components/wallet/CashoutModal.tsx` — amount + method picker with live preview
- `src/app/wallet/onboarding/complete/page.tsx` — Stripe return URL for wallet onboarding

## Known limitations

1. **Standard payout matching** is FIFO-by-account, not strictly tied to specific transfers — see `payout.paid` handler note above.
2. **No retry on failed instant payout** — falls back to standard automatically (with fee refund) rather than retrying.
3. **No admin tooling to cancel pending cashouts** — `cancelled` status is in the enum but no code path sets it. Add an admin endpoint when needed.
4. **No 1099/tax form generation** — Stripe Express handles tax docs via the connected account's own dashboard.
