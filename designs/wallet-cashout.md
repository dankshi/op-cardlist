# Wallet Cashout — Design Summary

> Human-readable version for sharing with stakeholders, partners, or pasting into Google Docs. Decision-and-rationale only; for technical implementation see [docs/wallet-cashout.md](../docs/wallet-cashout.md).

---

## What we're building

A way for Nomi users — sellers earning credits from sales, buyers holding refund credits — to actually take that money out of the platform and put it in their bank account. This closes the loop on the wallet: until now, credits could be earned and spent on Nomi, but they couldn't leave.

Two speeds offered, like Robinhood:

- **Standard** — free, lands in 1-3 business days via ACH.
- **Instant** — $1 fee, lands within minutes.

Minimum cashout: $10.

---

## Why this is worth doing

**1. Credits stuck on-platform aren't real money.** The wallet works well for power users who buy and sell often — they keep credits cycling. But the silent majority of sellers want to convert sales to cash. Until we ship cashout, every credit we issue is effectively an IOU the seller can't redeem outside our ecosystem. That's a trust problem, and at scale, a regulatory problem (stored-value-without-redemption laws differ state by state).

**2. It unblocks growth marketing.** "Sell your cards and get paid the next day" is a much more compelling pitch than "sell your cards and get store credit." Every competitor cashes sellers out. Catching up here removes an objection in seller acquisition.

**3. We already paid most of the cost.** Stripe Connect Express was wired up months ago for the original seller-payout idea (before we pivoted to credits). The plumbing exists, the dependency is in package.json, the seller-onboarding UI is built. Cashout is a 1-week project rather than a 4-week one.

---

## How we're doing it

**Stripe Connect Express** is the rail. Sellers (and now any user with a balance) connect a bank account through Stripe's hosted onboarding flow — the same one Stripe runs for DoorDash drivers, Substack writers, and thousands of other marketplaces. Stripe handles:

- Bank-account verification (instant via Plaid for major banks, fallback to micro-deposits)
- KYC (name, address, last 4 of SSN, date of birth)
- Compliance (1099 generation, sanctions screening)
- Identity verification when triggered

We don't store bank credentials; Stripe does. We don't mail 1099s; Stripe does. We don't run KYC review; Stripe does.

When a user requests a cashout:

1. We check their wallet balance and validate the amount.
2. We debit their credits immediately and write a ledger row.
3. We push funds from our Stripe balance into their connected Stripe account (a "transfer").
4. Stripe pays out from there to their bank — either on the standard daily schedule (free) or instantly (we pay Stripe a small fee, we pass on a flat $1 to the user).

If anything fails along the way, the credits go back to the wallet automatically.

---

## How it changes the user experience

**For the seller who used to wait for an authentication email and then check their balance:**

The wallet page now shows their available credits, their pending credits (sold but not yet authenticated), and a "Cash out" button. First-time cashout requires Stripe onboarding (about 3 minutes, mostly entering SSN and bank info). After that, cashing out is two clicks: amount, speed, done.

**For the buyer who got a refund as wallet credit:**

Previously they had to spend it on Nomi or it sat forever. Now they can cash it out. We expect most refund-credit users to still spend on Nomi — but the option matters.

**For the user during the cashout itself:**

A modal with the amount, a speed picker, and a clean "you'll receive / fee / total debited" preview. Standard is the default — it's free.

---

## Key design decisions

### Why $1 flat fee for instant, not 1%

Stripe charges us ~1% for instant payouts (with a $0.50 minimum). For a $10 instant cashout, charging the user 1% ($0.10) would actually be a loss. For a $1,000 cashout, charging 1% ($10) feels gouge-y.

Flat $1 is clean, easy to communicate, and matches user expectations from neobanks (Cash App charges 0.5–1.75%, Venmo is 1.75%, Robinhood is 1.5% — all percentage-based, but everyone in the cards space who's tried percentages has gotten complaints). At $10 cashouts we lose a fraction of a dollar; at $50+ we break even or make a small margin. We're not optimizing this for revenue — it's a service line, not a profit center.

### Why anyone with a balance can cash out, not just sellers

Buyers can accumulate credits via refunds (cancelled checkouts, intake issues, partial returns). Forcing buyers to spend refund credits on the platform — when many of them are casual one-time buyers who got refunded for a reason — generates support tickets and bad reviews. Letting anyone cash out makes the wallet feel like real money rather than a store-credit gift card.

The KYC cost is real (Stripe Connect onboarding takes ~3 minutes and asks for SSN), but it only happens once, and only when the user actually wants to cash out. Users who never cash out never see it.

### Why a $10 minimum

Below $10 the operational economics fall apart — Stripe transfer fees, instant payout floor ($0.50), and our own per-row processing make tiny cashouts a net loss. $10 also discourages the test-cashout-a-penny pattern that floods Stripe's KYC queue with low-quality verifications. If users want their last $7.30, they can spend it on the next order.

### Why we kept it on Stripe instead of going direct-to-Plaid

We seriously considered Plaid + Stripe ACH. The honest answer: Plaid is what Robinhood uses because Robinhood is a brokerage with its own treasury operation. Nomi is a marketplace. Plaid would mean:

- Adding a new vendor + new SDK + new compliance surface
- Building our own KYC pipeline (Stripe Express bundles it)
- Generating our own 1099s (Stripe Express does it)
- Maintaining our own bank-account-on-file storage
- Spending 3–4 more weeks of engineering for no user-visible benefit

Stripe Connect Express uses Plaid under the hood for instant bank verification anyway. The end-user experience is the same; we just don't carry the integration cost.

---

## What gets caught vs. what doesn't

**Atomic guarantees:**
- Concurrent cashout requests cannot overdraw the wallet (compare-and-swap on balance update).
- If the Stripe transfer fails, the credits are restored and a refund ledger row is written. The user never loses money to a transient failure.
- If the instant payout specifically fails (e.g., the bank account isn't instant-eligible), we fall back to a standard payout and refund the $1 fee — without canceling the cashout.

**Failures we handle:**
- Bank account rejected at payout time (closed, wrong routing number) → balance restored, cashout marked failed, user can retry.
- Stripe outage during cashout → request fails before any debit happens; user retries.
- Onboarding incomplete → user sees "Finish bank setup" instead of "Cash out," and clicks to resume.

**Edge cases we knowingly don't handle (yet):**
- **Pending cashout cancellation by the user** — once submitted, a cashout can't be cancelled from the UI. If the standard payout hasn't fired yet (within Stripe's batch window), we could in principle pull it back, but the UX value is low enough that we deferred it.
- **Splitting a cashout across multiple bank accounts** — one account per user. Sufficient for v1.
- **Scheduled / auto-cashouts** ("auto-withdraw whenever I hit $500") — easy to add later, not in v1.

---

## What this costs us

- **Per-instant-cashout fee:** Stripe charges ~1% with a $0.50 minimum. We collect $1 from the user. On a $10 instant cashout we net ~$0.40; on a $100 we net ~$0. The math is roughly break-even, with a small loss tolerance built in to keep messaging simple.
- **Standard payouts are free** to us and to the user. Stripe doesn't charge for batched ACH on Express accounts.
- **Engineering time:** ~1 week including the underlying schema fix (a column had been silently missing from migrations — caught during this work) and the webhook handling.

---

## What this saves us

It's not a cost-saver per se — it's a credibility play and a marketing unblock.

- Removes the #1 friction point in seller onboarding conversations: "but how do I get my money out?"
- Eliminates a class of support tickets: "I have credits but I'm done selling, how do I cash out?"
- Lets us advertise "next-day payouts" with a straight face in seller acquisition.
- Avoids regulatory risk from stored-value-without-redemption ambiguity (varies state by state — we don't want to test it).

---

## What success looks like

- **Adoption:** 60%+ of sellers with $100+ cumulative earnings have at least one cashout in the first 90 days.
- **Reliability:** <1% of cashout requests fail at the Stripe transfer step. Failures get auto-rolled-back without user intervention.
- **Mix:** 70-90% of cashouts choose standard (free). If everyone picks instant, our fee model is wrong.
- **Support load:** under 1 support ticket per 100 cashouts. Anything higher means the UI is confusing.

---

## What this is *not*

- **Not a checking account.** Funds in the wallet are not FDIC-insured and are not held in trust. The wallet is a balance on our platform; cashout converts it to real money in your real bank account.
- **Not international.** US bank accounts only in v1. Stripe Connect supports many countries but each adds compliance surface; we'll expand by country as demand justifies it.
- **Not a substitute for selling.** This is the back-end of the sales flow, not a new product line. We're not building a wallet-as-product or a peer-to-peer money-transfer feature.
- **Not buyer-side ACH payment.** A buyer can pay with credits or with a card. We're not adding "pay from your bank account" at checkout — that's a different stack (Stripe Financial Connections + Customer-attached bank accounts) and a different decision.

---

## Decisions still open

- **Instant payout fee** — $1 flat is our starting point. Will revisit if the mix skews heavily toward standard (suggests we underpriced) or if instant losses pile up (suggests we overpriced).
- **Cashout cancellation UX** — currently impossible to cancel a pending standard cashout. May add a "cancel" button with a short window if support volume warrants.
- **Minimum threshold** — $10. May raise to $20 if the support burden of small cashouts is non-trivial.

---

*Last updated: 2026-05-24. Live ledger schema and code paths: see [docs/wallet-cashout.md](../docs/wallet-cashout.md).*
