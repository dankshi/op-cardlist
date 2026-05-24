# Stripe Radar — Design Summary

> Human-readable version for sharing with stakeholders, partners, or pasting into Google Docs. Decision-and-rationale only; for technical implementation see [docs/stripe-radar.md](../docs/stripe-radar.md).

---

## What we're building

A fraud-detection layer in front of every card payment on Nomi. Three behaviors:

1. **Auto-block** the riskiest payment attempts before they ever become orders (stolen-card bots, known-bad cards, repeat decline attempts from the same IP).
2. **Flag** medium-risk charges for a quick human review. Flagged orders sit in a "Under Review" state — buyers see a polite "we're reviewing your order" message, sellers don't see it as shippable yet, payouts are held.
3. **Notify us proactively** when a card we charged was later reported stolen, so we can refund the buyer ourselves before the bank issues a chargeback. Avoids the $15 dispute fee per chargeback.

We're using Stripe's built-in product (Radar) plus a paid tier called **Radar for Fraud Teams** ($0.05 per screened transaction) that gives us custom rules, the review queue, and the stolen-card notifications.

---

## Why this is worth doing

Two reasons.

**1. The dollar math.** Most of Nomi's transactions are small-to-medium dollar, but the long tail includes single cards over $10,000 (the Luffy SP at $19,500 is a real listing). One chargeback at that price point — lost product, lost payout, $15 dispute fee, dispute paperwork time — is more expensive than a year of Radar fees across every transaction we'll do.

**2. Marketplace patterns that off-the-shelf fraud tools don't catch.** Stripe's machine learning is excellent at recognizing patterns from millions of merchants, but it doesn't know our specific risks. The two big ones we add custom logic for:

- **Self-dealing:** a single bad actor creates a buyer account *and* a seller account, then "sells" a fake card to themselves using a stolen credit card, walking away with the cash before the chargeback hits. From Stripe's POV this is a normal purchase; only we can see that the buyer and seller are the same person.
- **First-listing rush:** a seller signs up, immediately lists a $20k card, and the same day a brand-new buyer account purchases it. Almost certainly fraud, but each step is individually plausible to Stripe.

---

## How it changes the buyer/seller experience

**For the buyer who pays with a clean card on a normal-sized order:**
Nothing changes. They check out, get a confirmation, the seller ships.

**For the buyer paying $300+ on a new card from a new device:**
A "Verify with your bank" challenge pops up during checkout (3D Secure). If they pass, the order goes through immediately. If they're a real person this takes 10 seconds. If they're a fraudster using a stolen card, they likely can't pass.

**For the buyer making a $1,000+ purchase from a brand-new account:**
Order is accepted, but they see "We're reviewing your order — usually under 24 hours." We get an email, take 30 seconds to look at it, approve or refund. The seller doesn't see the order until we approve.

**For the seller:**
For 99% of orders, nothing changes. For the 1% under review, the order doesn't appear in their "Ready to ship" queue until it clears. This is the right tradeoff — sellers shouldn't ship cards on orders that might get refunded for fraud, because then we'd owe them money for goods we can't recover.

---

## Key design decision: high thresholds, not low

The big philosophical choice is **where to set the review threshold.** Two extremes:

- **Aggressive (low threshold):** flag everything over $200 from anyone newer than 30 days. Catches almost all fraud, but buries the review queue in false positives, delays legitimate buyers, and creates a bad customer experience.
- **Permissive (high threshold):** flag only $1,000+ from accounts under 7 days old; let the rest clear automatically with the help of 3D Secure on amounts over $200. Catches the dollar-weighted majority of fraud (the expensive frauds), keeps the review queue small enough that a solo founder can clear it in 5 minutes a day.

**We chose permissive.** The reasoning:

- A solo founder can't process 50 reviews a day. Even 5 is annoying.
- Most actual fraud on a card-collectibles marketplace targets high-value items — that's where the resale value is.
- Medium-value fraud ($200–$1000) is real but absorbable. At a worst-case chargeback rate of 0.5% on that band, we'd absorb maybe a few hundred dollars a month in losses, which is less than the revenue we'd lose by alienating legitimate buyers with friction.
- Automated controls (auto-block + 3D Secure) handle most of the riskiest signatures regardless of dollar amount.

**Revisit if:** the actual chargeback rate climbs above 0.5% in any month. At that point we tighten thresholds and accept more review burden.

---

## What gets caught vs. what doesn't

**Auto-blocked (no human involvement, charge never succeeds):**
- Card-testing bots: more than 5 different cards tried from the same IP in an hour
- More than 3 declines on the same card in an hour
- Disposable email domains (Mailinator, 10minutemail, etc.)
- Charges Stripe's ML rates as highest-risk
- Failed CVC or postal-code verification on suspicious charges

**Forced to verify with bank (3D Secure):**
- Any charge over $200

**Held for human review:**
- Orders over $5,000 (regardless of who's buying — these are always worth a second look)
- Orders over $1,000 from accounts under 7 days old
- Billing country doesn't match shipping country
- IP country doesn't match billing country (often a fraud signal — buyer using a VPN or stolen card from abroad)

**Custom checks we run in our own code (not in Stripe):**
- Self-dealing detection (buyer and seller share IP or device, or both accounts created within 24 hours)
- First-listing rush (new seller's first listing sells to a new buyer within 24 hours)
- Lifetime-spend allowlist (we trust repeat customers above a threshold without review)

**What we knowingly don't catch:**
- Coordinated fraud rings with patient timing (account aged 30+ days, then strikes)
- First-party fraud (real buyer claims they "never received" a card they actually got — handled separately via tracking/photo evidence at intake)
- Account-takeover fraud where the legitimate cardholder's Stripe account is compromised (rare, and Stripe's own systems handle this layer)

---

## What this costs us

- **Per-transaction fee:** $0.05 per charge Stripe screens. On a $50 order this is 0.1%. On a $5,000 order it's 0.001%. Effectively rounding error.
- **Engineering time:** ~2-3 focused days of work for the initial build (database changes, webhook handlers, admin review inbox, custom risk checks). Already scoped in the technical plan.
- **Ongoing operational time:** review queue handled by founder, expected ~5 min/day at current volume, scaling up if/when we hire support.

---

## What this saves us

Estimating conservatively from industry baseline chargeback rates of ~0.5% on marketplaces *without* fraud controls:

- At 100 orders/month averaging $200, that's $100/mo in chargebacks + ~$7.50/mo in dispute fees = **~$107/mo**.
- At 1,000 orders/month averaging $300, that's $1,500/mo in chargebacks + ~$75/mo in dispute fees = **~$1,575/mo**.

Plus the one-time impact of any single high-value chargeback avoided: a $10k stolen-card fraud caught by EFW (Early Fraud Warning) is a $10,015 save *and* preserves the inventory for resale.

Cost-benefit is positive from day one and gets dramatically better as volume scales.

---

## What success looks like

- Chargeback rate stays under 0.5% of transaction volume.
- Review queue averages under 10 items/day for the first three months.
- False-positive rate (legitimate buyers we incorrectly block or send to review) stays under 2% — measured by manual approval rate on flagged orders.
- No single-incident chargeback over $5,000 in the first six months.

If any of these slip, the threshold philosophy gets revisited.

---

## What this is *not*

- **Not authentication.** We're not verifying buyer or seller identity in any deep sense. That's a separate problem (KYC, ID verification) handled by Stripe Connect on the seller side and by our existing email-confirmation flow on the buyer side.
- **Not a substitute for intake QA.** Fraudulent listings (fake cards, miscondition cards) are caught at intake by our authentication team. Radar catches *payment* fraud, not *product* fraud.
- **Not chargeback prevention in the legal sense.** When a chargeback happens, we still have to dispute it through Stripe's dispute process. Radar just reduces how often that happens and gives us a head-start (via Early Fraud Warnings) on the ones that are coming.

---

## Decisions still open

- **Threshold tuning** — initial values are best-guess; will adjust monthly based on actual false-positive and chargeback data.
- **Multi-reviewer support** — single reviewer (founder) for now. If volume grows past 30 reviews/day, we'll need an admin role + assignment workflow.
- **Buyer communication on review** — current copy is generic ("under review, usually < 24 hrs"). May want to differentiate copy for legit-but-flagged buyers (apologetic) vs. likely-fraud (curt) once we have data on patterns.

---

*Last updated: 2026-05-24. Live rule state and engineering implementation: see [docs/stripe-radar.md](../docs/stripe-radar.md).*
