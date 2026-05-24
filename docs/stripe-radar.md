# Stripe Radar

## What it is

Stripe Radar is the fraud-detection layer in front of every card charge on Nomi. It does three things:

1. **Auto-blocks** the riskiest payment attempts before they ever hit our order pipeline (card testing, known-bad cards, velocity attacks).
2. **Flags** medium-risk charges for manual review by the founder — the order sits in `under_review` instead of going straight to `paid`, sellers don't see it yet, payouts are held.
3. **Notifies** us proactively when Stripe learns a card was reported stolen (Early Fraud Warning), so we can refund before a chargeback hits and avoid the $15 dispute fee.

Baseline Radar is free and runs automatically on every Stripe charge. We pay $0.05 per screened transaction for **Radar for Fraud Teams**, which unlocks custom rules, the review queue, 3DS-by-rule triggers, allow/block lists, and Early Fraud Warnings.

---

## Why now

Two reasons:

- **AOV mix has $10k+ outliers.** A single Luffy SP at $19,500 + chargeback fee + lost product is a worse hit than years of $0.05-per-txn Radar fees.
- **Marketplace patterns Stripe's stock ML doesn't catch.** Self-dealing (fraudster creates buyer + seller, sells fake card to self with stolen CC, withdraws "seller earnings") and first-listing-rush fraud are marketplace-specific and need custom signals layered on top.

---

## Design summary

### Threshold philosophy

**High review thresholds. Lean on automated controls (block + 3DS) for the long tail.**

The alternative — flagging everything > $200 for manual review — buries the inbox in false positives and delays legit orders. Setting the review threshold high ($1k+ from new accounts) means most legit purchases clear instantly, and the few flags that land are signal.

**Tradeoff:** medium-value fraud ($200–$1000) clears automatically. Acceptable because auto-block + 3DS catches the riskiest payment signatures, and chargebacks at that dollar range don't bankrupt anyone. Revisit thresholds if chargeback rate exceeds 0.5%.

### Stripe-side rules

| Action | Intent |
|--------|--------|
| **Block** | Too many unique cards from same IP (card-testing bot) |
| **Block** | Too many declines on the same card (stolen-card brute force) |
| **Block** | Disposable email domain |
| **Block** | Stripe's own ML rates the charge `highest` risk |
| **Review** | Order > $1,000 from account < 7 days old |
| **Review** | Any order > $5,000 (regardless of history) |
| **Review** | Billing country ≠ shipping country |
| **3DS** | Every purchase > $200 |
| **3DS** | First-time IP for this customer |
| **3DS** | IP country ≠ billing country |
| **Allow** | Lifetime spend > $5,000 (skip review on trusted buyers) |

Rules live in **Stripe Dashboard → Settings → Radar → Rules**. Not configurable via API.

#### Paste-ready Radar expressions

In the Stripe Dashboard, the action (Block / Review / Request 3D Secure / Allow) is picked from a dropdown at the top of the rule editor — the condition field below only takes the expression after `if`. Add each rule via **+ Add rule**; one rule per condition.

Attribute names are taken from Stripe's [supported attributes reference](https://docs.stripe.com/radar/rules/supported-attributes) — verify each in the editor's **Attributes** autocomplete before saving, as Stripe's reference docs occasionally lag the actual attribute set.

| Action | Condition |
|--------|-----------|
| Block | `:card_count_for_ip_address_hourly: > 5` |
| Block | `:declined_transactions_per_payment_instrument_fingerprint_hourly: > 3` |
| Block | `:is_disposable_email:` |
| Review | `:amount_in_usd: > 1000.00 AND :seconds_since_email_first_seen_on_stripe: < 604800` |
| Review | `:amount_in_usd: > 5000.00` |
| Review | `:billing_address_country: != :shipping_address_country:` |
| Request 3D Secure | `:amount_in_usd: > 200.00` |
| Request 3D Secure | `:ip_country: != :billing_address_country:` |

`:risk_level: = 'highest'` is in Stripe's default rule set — keep it enabled, don't re-add.

#### Live rule state (as deployed in test mode)

Snapshot of what's actually enabled in the Stripe Dashboard after Phase 0. Update this section when rules are added, removed, or tuned. **16 rules total, 14 enabled, 2 disabled.**

**Block (7 enabled)**
- `:risk_level: = 'highest'` *(Stripe default)*
- Default Stripe block lists *(Stripe default)*
- `:card_count_for_ip_address_hourly: > 5`
- `:declined_transactions_per_payment_instrument_fingerprint_hourly: > 3`
- `:is_disposable_email:`
- CVC verification fails based on risk score *(Stripe default — toggled on)*
- Postal code verification fails based on risk score *(Stripe default — toggled on)*

**Review (4 enabled, 1 disabled)**
- `:amount_in_usd: > 5000.00`
- `:amount_in_usd: > 1000.00 AND :seconds_since_email_first_seen_on_stripe: < 604800`
- `:billing_address_country: != :shipping_address_country:`
- `:ip_country: != :billing_address_country:` — *deliberately Review (not 3DS) because IP-country / billing-country mismatch is a strong-enough fraud signal to warrant a human look.*
- `:risk_level: = 'elevated'` — DISABLED *(would flood the inbox; Stripe's "elevated" rating often just means "new customer + medium amount")*

**Request 3D Secure (1 enabled, 1 disabled)**
- `:amount_in_usd: > 200.00`
- If 3D Secure is supported for card — DISABLED *(would 3DS every payment; too aggressive)*

**Allow (2 enabled)**
- Default Stripe allow lists *(Stripe default)*
- Payment not high risk + 3DS + liability shift *(Stripe default — toggled on; free liability shift on authenticated payments)*

#### Checks moved to app code (Phase 4) — Radar can't express them

- **Lifetime-spend allowlist** (`total_usd_amount_successful_on_customer_all_time` requires Stripe Customer objects, which we don't create for buyers). Compute from `orders` table in `evaluateOrderRisk`.
- **Buyer account < 7 days old** — `seconds_since_email_first_seen_on_stripe` is a usable proxy for repeat buyers, but for first-time-on-our-platform we have `profiles.created_at` directly. Use that in `evaluateOrderRisk` for the cleaner signal.
- **New-IP-for-this-buyer 3DS trigger** (`:is_new_ip:` doesn't exist on Stripe's side). Track `last_login_ip` on profiles, compare at order time, set `under_review` if mismatch.

**Gap to know about:** Stripe doesn't expose a "declines per IP" velocity attribute — only per-payment-instrument. So the brute-force decline rule above catches repeated declines on a single card, but not someone cycling through 10 stolen cards from one IP. The `card_count_for_ip_address_hourly > 5` rule covers that vector instead.

### Custom marketplace-fraud signals (beyond Radar)

Two patterns Radar alone can't see, evaluated in our own code at order-creation time:

- **Self-dealing**: buyer and seller share IP or device fingerprint, OR both accounts were created within 24 hours of each other. Flag → `under_review`.
- **First-listing rush**: a seller's first-ever listing transacts within 24 hrs of being posted, AND the buyer's account is < 7 days old. Flag → `under_review` regardless of dollar amount.

We still let Stripe Radar evaluate the charge in parallel — these custom flags are additive, not replacements.

---

## Order state machine

```
pending_payment  →  under_review  →  paid  →  seller_shipped  →  received
                         ↓                ↓
                     cancelled       (existing flow)
```

- `pending_payment` — intent created, payment not yet attempted.
- `under_review` — Radar opened a review OR our custom signals flagged it. Buyer sees "Order received, reviewing — usually < 24 hrs." Seller does **not** see it as shippable. Payout is held.
- `paid` — review approved (or no review needed). Seller email fires, inventory finalizes, existing post-delivery payout delay starts.
- `cancelled` — review refunded, EFW auto-refund, or dispute. Inventory released, buyer refunded (card + credits).

---

## Implementation status

All seven phases are landed in code (Phases 0–6 shipped, Phase 7 is the manual test runbook below).

### Phase 0 — Stripe Dashboard config ✅

11 rules live in test mode (see [Live rule state](#live-rule-state-as-deployed-in-test-mode) above). Webhook endpoint subscribed to `review.opened`, `review.closed`, `radar.early_fraud_warning.created`, `charge.dispute.created`. Live-mode copy still pending — wait until Phase 7 testing passes.

### Phase 1 — DB schema ✅

Migration: [supabase/migrations/20260543_radar_fraud_review.sql](../supabase/migrations/20260543_radar_fraud_review.sql).

- Added `under_review` to `order_status` enum (after `pending_payment`).
- Added to `orders`: `stripe_review_id`, `risk_score`, `risk_level`, `review_opened_at`, `review_closed_at`, `review_reason`, `review_closed_reason`, `auto_flagged_reasons jsonb`.
- Added to `profiles`: `last_login_ip inet`, `last_seen_at timestamptz`.
- Partial index `idx_orders_under_review` for the inbox query.

Types: [src/types/database.ts](../src/types/database.ts) — `OrderStatus` extended, new `RiskLevel` type, new fields on `Order` and `Profile`.

**To deploy:** `supabase db push` (or your normal migration deploy path). The new code references columns that don't exist yet — app throws at runtime until this migration lands.

### Phase 2 — Webhook handlers ✅

[src/app/api/stripe/webhooks/route.ts](../src/app/api/stripe/webhooks/route.ts):

- `review.opened` → `markOrderUnderReview()` with Stripe review id + risk score/level.
- `review.closed` → if `approved`, calls `finalizeOrderAsPaid()` directly. If `refunded`/`refunded_as_fraud`, calls `cancelOrderWithRefund()`.
- `radar.early_fraud_warning.created` → issues `stripe.refunds.create({ reason: 'fraudulent' })` first, then `cancelOrderWithRefund()`. **Refund-first ordering matters**: if Stripe refund fails, we don't mark the order cancelled (buyer hasn't been made whole).
- `charge.dispute.created` → sets order to `disputed` with `admin_notes` capturing reason + amount.
- `payment_intent.succeeded` now checks `charge.outcome.type === 'manual_review'` via `getOpenReviewForPaymentIntent()` and defers to `under_review` instead of `paid` when Stripe flagged the charge.

`processOrderPayment` was tightened to pending_payment-only. `finalizeOrderAsPaid` + `bumpSellerGmvAndTier` extracted to [src/lib/orderPayment.ts](../src/lib/orderPayment.ts) so admin approve route can reuse them. Cancel-with-refund logic in [src/lib/orderCancel.ts](../src/lib/orderCancel.ts).

### Phase 3 — App-side state + flow ✅

- [src/app/admin/page.tsx](../src/app/admin/page.tsx) — `under_review` + `disputed` added to `STATUS_LABELS`/`STATUS_STYLES`; "Risk Review →" link in header.
- [src/app/orders/[orderId]/page.tsx](../src/app/orders/[orderId]/page.tsx) — banner above the pipeline stepper with different copy for buyer vs seller. Sellers see "Don't ship yet — we're verifying the payment to protect you from chargebacks."
- [src/app/mystuff/page.tsx](../src/app/mystuff/page.tsx) — `under_review` shows as "Under Review — Don't Ship Yet" in the seller's Orders tab; correctly excluded from "Pending Orders" count.
- [src/app/checkout/success/page.tsx](../src/app/checkout/success/page.tsx) — server-fetches order status and shows "Order Received — Under Review" copy + amber icon when flagged.
- All seller ship/label routes (`/api/orders/[orderId]/ship`, `/api/orders/[orderId]/label`) already gate on `status === 'paid'` — no changes needed; `under_review` is naturally locked out.

### Phase 4 — Custom self-dealing detection ✅

[src/lib/risk.ts](../src/lib/risk.ts):

```ts
evaluateOrderRisk(supabase, { buyerId, sellerId, buyerIp, listingId })
  → { flag: boolean, reasons: RiskReason[] }
```

Three signals:
- `self_dealing_same_ip` — buyer's current request IP matches seller's `last_login_ip` (only if `last_seen_at < 7 days` to avoid stale-IP false positives).
- `self_dealing_account_proximity` — buyer + seller account `created_at` within 24 hrs of each other.
- `first_listing_rush` — listing < 24 hrs old AND buyer account < 7 days old AND it's the seller's first-ever listing.

Called from [src/app/api/stripe/payment-intent/route.ts](../src/app/api/stripe/payment-intent/route.ts) after order creation; if flagged, sets `status='under_review'` immediately with `auto_flagged_reasons` populated. Stripe Radar still evaluates the charge in parallel.

`last_login_ip` + `last_seen_at` populated in [src/app/auth/callback/route.ts](../src/app/auth/callback/route.ts) on every successful sign-in via `extractClientIp()`.

### Phase 5 — Admin risk inbox ✅

- [src/app/admin/risk/page.tsx](../src/app/admin/risk/page.tsx) — lists `under_review` orders sorted by `risk_score desc`. Shows risk level chip, Stripe reason, our marketplace flag chips, buyer age in days, one-click Approve / Refund.
- [src/app/api/admin/risk/[orderId]/approve/route.ts](../src/app/api/admin/risk/[orderId]/approve/route.ts) — calls `stripe.reviews.approve()` (best-effort) and `finalizeOrderAsPaid()`. Handles both Stripe-reviewed and marketplace-only-flagged orders.
- [src/app/api/admin/risk/[orderId]/refund/route.ts](../src/app/api/admin/risk/[orderId]/refund/route.ts) — issues Stripe refund (`reason: 'fraudulent'`) then `cancelOrderWithRefund()`.

Detail page was deferred — list view shows enough context for quick approve/refund. Add later if reviews need deeper context (buyer history, prior orders, etc).

### Phase 6 — 3DS verification ✅

Confirmed working without code changes. [src/components/checkout/CheckoutForm.tsx:227](../src/components/checkout/CheckoutForm.tsx#L227) uses `stripe.confirmPayment({ elements, confirmParams: { return_url } })` which automatically handles 3DS challenges via Stripe Elements:

1. PaymentIntent created server-side with `automatic_payment_methods: { enabled: true }`.
2. On submit, Stripe Elements checks if 3DS is required (per our Radar rules: any charge > $200, plus card-issuer triggers).
3. If yes, renders the 3DS iframe/modal in-place; if no, processes immediately.
4. On 3DS pass, redirects to `return_url` with `payment_intent` + `payment_intent_client_secret` query params Stripe injects.
5. Our `payment_intent.succeeded` webhook handles the rest.

Verify in Phase 7 with test card `4000002500003155`.

### Phase 7 — Testing runbook (manual)

See **[Testing runbook](#testing-runbook)** below.

---

## Deploy checklist

Code is shipped but several pieces need manual action before this works in test mode (and again before live mode):

1. **Run the migration**: `supabase db push` (or your normal deploy path). The new code references the `under_review` enum + new columns; until the migration lands, every checkout will throw at runtime.
2. **Start `stripe listen` in dev**: `stripe listen --forward-to localhost:3000/api/stripe/webhooks`. Without this, no webhook events reach localhost — orders sit stuck the same way the March pending_payment orders did. The `whsec_...` it prints must match `STRIPE_WEBHOOK_SECRET` in `.env.local`.
3. **Walk the [Testing runbook](#testing-runbook)** end-to-end in test mode.
4. **Only then** copy each Radar rule from test → live mode via the dashboard's "Copy to live" button per rule.

---

## Testing runbook

Manual E2E walkthrough. Run each scenario, verify the listed state at each step. Expected wall time ~30 min for the full suite.

### Setup once

```bash
# Terminal 1: dev server
pnpm dev

# Terminal 2: Stripe webhook tunnel
stripe listen --forward-to localhost:3000/api/stripe/webhooks
```

Confirm the `whsec_...` printed by `stripe listen` matches `STRIPE_WEBHOOK_SECRET` in `.env.local`. Sign in as a test buyer account ("test" profile) with at least one card listed by a different seller account.

### Test cards reference

| Card number | What it triggers |
|-------------|------------------|
| `4242 4242 4242 4242` | Normal success — clean charge, no review |
| `4000 0000 0000 9235` | Radar opens a manual review (charge succeeds, marked under_review) |
| `4000 0000 0000 0259` | Charge succeeds, then EFW fires ~immediately |
| `4100 0000 0000 0019` | Auto-blocked by Radar (charge never succeeds) |
| `4000 0025 0000 3155` | 3D Secure challenge required |

CVC any 3 digits, expiry any future date, ZIP any 5 digits.

### Scenario A: normal success (sanity check)

1. Add card to checkout, pay with `4242 4242 4242 4242`.
2. **Expect:** redirected to `/checkout/success` with green "Order Confirmed!" message.
3. **DB:** order is `paid`, `paid_at` set, no `review_*` fields populated.
4. **Webhook log:** `payment_intent.succeeded` → no review detected → `processOrderPayment` → status=paid.
5. **Seller mystuff:** order shows in "Action Required" status, ready to ship.
6. **Inbox:** seller got new-order email, buyer got receipt email.

### Scenario B: Radar review → approve

1. Pay with `4000 0000 0000 9235`.
2. **Expect:** `/checkout/success` shows amber "Order Received — Under Review".
3. **DB:** order is `under_review`, `stripe_review_id` populated, `risk_score` set, `review_reason='rule'` or similar.
4. **Webhook log:** `payment_intent.succeeded` → `getOpenReviewForPaymentIntent` returns non-null → `markOrderUnderReview`. Possibly also a separate `review.opened` event (handled idempotently).
5. **Seller mystuff:** order shows as "Under Review — Don't Ship Yet" in Orders tab. Pending Orders count unchanged.
6. **Order page (as buyer):** amber banner — "We're reviewing your order, usually clears within 24 hrs."
7. **Order page (as seller):** amber banner — "Don't ship yet — we're verifying."
8. **Admin /admin/risk:** order appears with risk score, Stripe reason chip, Approve / Refund buttons.
9. Click **Approve** in the admin inbox.
10. **Expect:** order disappears from /admin/risk list.
11. **DB:** status=`paid`, `paid_at` set, `review_closed_at` set, `review_closed_reason='approved'`.
12. **Seller mystuff:** order now shows "Action Required" — ready to ship.
13. **Inbox:** seller now got the new-order email (deferred from initial charge).

### Scenario C: Radar review → refund

1. Pay with `4000 0000 0000 9235` (same as B).
2. Verify order lands as `under_review` (same as B steps 1–8).
3. Click **Refund** in the admin inbox, confirm the prompt.
4. **Expect:** order disappears from /admin/risk list.
5. **DB:** status=`cancelled`, `admin_notes` contains `[auto-cancel] admin_risk_review_refund`, `review_closed_reason='refunded'`.
6. **Listings:** the reserved listing inventory is restored (`status='active'`, `quantity_available` back up).
7. **Credits:** if buyer applied any, balance restored + `credit_transactions` row with `type='refund_credit'`.
8. **Stripe dashboard:** the charge shows refunded with `reason: 'fraudulent'`.
9. **Inbox:** seller did NOT get a new-order email (correctly suppressed).

### Scenario D: Early Fraud Warning (auto-refund)

1. Pay with `4000 0000 0000 0259`. Initial charge succeeds normally (order goes to `paid`).
2. Wait ~30 seconds for the EFW webhook (Stripe simulates a fraud signal from the test card).
3. **Expect:** order silently transitions to `cancelled` without admin action.
4. **DB:** status=`cancelled`, `admin_notes` contains `[auto-cancel] early_fraud_warning`.
5. **Stripe dashboard:** charge refunded with reason `fraudulent`; the EFW shows as actioned.
6. **Inbox:** ⚠️ check whether the seller email was already sent before EFW fired. If the order briefly hit `paid` first, the seller email went out. Acceptable but worth noting; the order detail page now shows cancelled.

### Scenario E: Self-dealing (marketplace flag, no Stripe review)

1. Sign in as the test buyer in one browser tab. Note the IP (any local IP will do for the test).
2. In a private/incognito window, sign in as the seller account (the same physical IP — that's the point).
3. As the buyer, checkout the seller's listing with `4242 4242 4242 4242`.
4. **Expect:** redirected to `/checkout/success` with the amber "Under Review" message (NOT green).
5. **DB:** status=`under_review`, `auto_flagged_reasons` contains `["self_dealing_same_ip"]` (and possibly `self_dealing_account_proximity` if both test accounts were created recently). `stripe_review_id` is null (Stripe didn't open this — we did).
6. **Admin /admin/risk:** order shows with amber "Buyer & seller share IP" chip; no Stripe reason chip. Approve / Refund buttons work.

If the IP check doesn't fire, verify `profiles.last_login_ip` is populated for the seller (sign them out + back in).

### Scenario F: 3D Secure challenge

1. Pay with `4000 0025 0000 3155` for an amount > $200 (any of your higher-value test listings).
2. **Expect:** Stripe Elements renders the "Complete payment" 3DS modal in-place.
3. Click "Complete" in the simulated bank screen.
4. **Expect:** redirected to `/checkout/success` with green "Order Confirmed!" (3DS pass shifts liability — should clear cleanly).
5. **DB:** order is `paid`, no review.
6. **Stripe dashboard:** charge shows "3D Secure: authenticated" with liability shift.

If 3DS modal doesn't appear: check the Radar 3DS rule (`Request 3D Secure if :amount_in_usd: > 200.00`) is enabled in test mode and the charge actually exceeds $200.

### Scenario G: Auto-block (charge never lands)

1. Pay with `4100 0000 0000 0019`.
2. **Expect:** payment fails immediately at checkout with Stripe's "card declined" message.
3. **DB:** order stays in `pending_payment` (no PI succeeded webhook ever fires).
4. **Webhook log:** `payment_intent.payment_failed` may fire (we don't currently handle it — order is left orphaned, same pattern as legitimate user-abandoned checkouts).
5. **Cleanup:** stale pending_payment orders get cancelled by the next user-checkout attempt for the same listing (existing `staleOrders` logic in payment-intent route), or run [scripts/cancel-stuck-orders.ts](../scripts/cancel-stuck-orders.ts).

### Common failures

- **"under_review" not recognized / column does not exist** → migration hasn't been pushed. Run `supabase db push`.
- **Webhook events not showing in `stripe listen`** → check `STRIPE_WEBHOOK_SECRET` in `.env.local` matches the secret printed by `stripe listen` on startup.
- **Order stuck in `pending_payment` after pay** → `stripe listen` isn't running, OR the webhook handler errored. Check terminal output of both.
- **Self-dealing check never fires in Scenario E** → `profiles.last_login_ip` is null for the seller. Sign them out + back in to trigger the auth callback population.
- **Approve button does nothing visible** → check `is_admin` is true on your profile. The `/api/admin/risk/*` routes return 403 silently in the UI.

### When to copy to live mode

After all 7 scenarios pass in test mode AND you've watched at least one real test charge land cleanly via `stripe listen`, then for each rule in `https://dashboard.stripe.com/test/radar/rules` click the rule → "Copy to live" button at the top.

---

## Risk areas to watch

- **Payout race condition.** If any payout path (cron, manual button) treats anything other than `status='paid'` as payable, fraud clears. Audit every payout call site after Phase 3.
- **Email already sent.** Seller new-order email must only fire post-review. If it fires on `pending_payment → under_review` transition, sellers get notified about flagged orders.
- **Credits already debited at intent creation.** Buyer credits are subtracted at [payment-intent/route.ts:237](../src/app/api/stripe/payment-intent/route.ts#L237). Review-refund path must credit them back — verify the cancel-credits-refund logic handles `review.closed (refunded)` as a trigger, not just `payment_intent.canceled`.
- **Tuning blindspot.** First month of data is the only honest signal. Block too many legit buyers and you lose revenue silently (no error, just missing orders). Review the Stripe Radar dashboard's "false positive" estimate weekly for the first 30 days.

---

## Connecting Stripe via MCP (optional, for ops/debugging)

Stripe runs a remote MCP server at `https://mcp.stripe.com` that lets Claude Code (or any MCP client) query Stripe data through chat. Useful for inspecting reviews/disputes/charges during Radar work without dashboard-hopping.

### Setup

1. **Stripe Dashboard** → Settings → Team and security → **MCP access** → enable "Allow MCP access through OAuth".
2. **Claude Code**:
   ```bash
   claude mcp add --transport http stripe https://mcp.stripe.com/
   claude /mcp
   ```
   Complete the OAuth flow in your browser as your Stripe user.

Access is scoped to the team member's Stripe role — read-only devs get read-only access, admins get full.

### What works via MCP

Disputes (`list_disputes`, `update_dispute`), refunds (`create_refund`), payment intents (`list_payment_intents`), general Stripe resource search.

### What doesn't

The Radar **rule editor** is a Dashboard product — rules can't be configured via API or MCP. Early Fraud Warnings and Radar Reviews aren't currently exposed as tools either. Phase 0 stays manual.

### Security

The page recommends [restricted API keys](https://docs.stripe.com/keys/restricted-api-keys.md) over secret keys when not using OAuth, to limit blast radius if a key leaks. With OAuth (the recommended path) this is moot — token is scoped to the member's role and revocable from the dashboard.

---

## Related docs for admins

If you're an admin reading this to understand the fraud-review workflow, these are the adjacent docs you'll want:

- [credits-and-wallet.md](./credits-and-wallet.md) — how buyer credits are debited at checkout and refunded on cancellation. Critical context for what `review.closed (refunded)` has to undo in the wallet.
- [admin-intake-flow.md](./admin-intake-flow.md) — the existing admin operations pattern (exception queue, single-operator workflow). The `/admin/risk` review inbox in Phase 5 follows the same conventions.
- [ARCHITECTURE.md](./ARCHITECTURE.md) — overall system layout, where the marketplace + Stripe Connect pieces fit.

For the non-technical, decision-and-rationale version of this design (shareable with stakeholders / Google Docs), see [designs/stripe-radar.md](../designs/stripe-radar.md).
