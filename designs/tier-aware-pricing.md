# Tier-Aware Pricing — Design Summary

> Human-readable version for sharing with stakeholders, partners, or pasting into Google Docs. Decision-and-rationale only; technical implementation lives in `src/lib/fees.ts` (single source of truth), with callers in `src/app/api/stripe/checkout/route.ts`, `src/app/api/stripe/payment-intent/route.ts`, `src/app/api/admin/orders/[orderId]/status/route.ts`, and the sell flow at `src/app/sell/page.tsx`.

---

## What we're building

A pricing model that rewards seller volume. Instead of charging every seller a flat 9.5% marketplace fee, **graded-card sellers** pay a tiered rate (7.0%–9.0%) that decreases as their lifetime sales grow. Raw cards stay at the flat 9.5% across every tier.

Five tiers, keyed off lifetime GMV (gross merchandise value):

| Tier | GMV qualifier | Graded fee % |
|------|---------------|-------------|
| Basic | $0 – $1.5k | 9.0% |
| Silver | $1.5k – $5k | 8.5% |
| Pearl | $5k – $25k | 8.0% |
| Gold | $25k – $100k | 7.5% |
| Diamond | $100k+ | 7.0% |

Plus a manual-only "Elite" tier (P2P fulfillment, 6.5%) reserved for the highest-trust sellers.

Three fulfillment methods sit on top of the tier ladder, each with its own seller-side cost:

- **Ship to Nomi** — seller mails cards to us, we authenticate and ship to the buyer. $5 seller fee per order (covers the inbound label).
- **Drop to Nomi** — seller drops off in person. $0 seller fee.
- **P2P** — seller ships directly to buyer, no Nomi handling. $0 seller fee, Elite tier only.

The full breakdown — marketplace %, seller fee, processing fee, net payout — is computed in one place (`calculatePayout()` in `src/lib/fees.ts`) and called from every surface that needs it: sell-page payout estimate, home-page payout calculator, checkout flow, payment-intent flow, and the seller-credit step when admin authenticates the order.

---

## Why this is worth doing

Three reasons.

**1. Aligns incentives with the sellers we want to keep.** The 80/20 rule applies in spades on a marketplace: a handful of power sellers move most of the dollar volume, and they're the easiest to lose to a competitor who undercuts by even a half-point. A 2-point spread between Basic (9%) and Diamond (7%) on a $5,000 sale is $100 in their pocket per transaction — meaningful enough to anchor them but not so steep that it tanks our take rate on the long tail.

**2. Pricing transparency vs. negotiated deals.** The alternative is what most marketplaces do quietly: case-by-case fee negotiation for big sellers, opaque to everyone else. Publishing the tier ladder publicly removes the "did I get a worse deal than that other guy?" anxiety and replaces it with a clear ladder anyone can climb. Sellers know exactly what they need to do to lower their rate.

**3. Raw stays flat to keep the low-end frictionless.** Raw cards are the volume floor — lots of $5–$50 transactions where a 0.5-point fee delta is rounding error and a tier system would just be cognitive overhead. Keeping raw at flat 9.5% means a casual seller listing their three NM commons doesn't have to think about tiers, GMV, or fulfillment methods. The tier system only matters when you're selling enough that it should matter.

---

## How the fee math works

For any sale, the payout calculation is:

```
sale_price
 − seller_fee         (0 for drop/p2p, 5 for ship)
 − marketplace_fee    (sale_price × tier %, or 9.5% if raw)
 − processing_fee     (sale_price × 3%, Stripe passthrough)
= seller_payout
```

`calculatePayout()` returns the full breakdown including the percentages used, so the UI can show "Platform fee (8.5%) · silver" instead of just a dollar amount. The breakdown is also persisted on the `orders` table (`seller_fee`, `marketplace_fee`, `processing_fee`, `seller_tier_at_sale`) so the math is auditable even if the seller later tiers up.

The 3% processing fee is a passthrough — it's what Stripe charges us to process the card. We don't make money on it. Splitting it out from the marketplace fee makes the math honest and explains the gap between "platform fee" and "what actually leaves the buyer's account."

---

## Key design decision: graded-only tiers, raw flat across the board

The choice that drove every other decision is **which cards qualify for tier pricing.** Three options we considered:

- **Tier everything.** Lower the long-tail floor across the board. Problem: it complicates the casual-seller mental model for very little dollar impact at the low end. A 0.5% delta on a $20 raw card is 10¢. Doesn't change anyone's behavior.
- **Tier graded only** (chosen). Graded cards are where the dollar concentration is — $100–$10,000 transactions where the rate genuinely matters. A 2-point spread on a $2,000 slab is $40, which is meaningful to a power seller. Keeps the messaging clean: "the more you sell of the expensive stuff, the better your rate."
- **Per-set or per-rarity tiers.** Over-fit and impossible to communicate. Rejected outright.

The graded-only rule also has a clean dual purpose: it nudges sellers toward the kinds of inventory that drive marketplace differentiation (we're not trying to be a $5-common emporium).

**Revisit if:** raw-card competition gets aggressive enough that even casual sellers feel a 9.5% rate as friction. At that point we'd consider a Silver-Raw rate (e.g. 9%) for sellers who clear the Silver GMV threshold.

---

## How it changes the experience

**For a brand-new seller listing their first card:**
Tier defaults to Basic (9% graded / 9.5% raw). The sell-page payout estimate shows the exact breakdown with the tier name visible. If they wanted to know "how do I lower this?" the home-page pricing chart shows the full ladder + the GMV they need.

**For a seller on Silver who lists a graded card:**
Marketplace fee drops from 9.0% to 8.5%. UI shows "Platform fee (8.5%) · silver" inline so they can see the discount at the moment of listing. The math compounds — over a year of grade-heavy selling the savings add up to real money.

**For a Diamond seller:**
7% marketplace fee, plus eligibility to opt into P2P fulfillment (Elite tier, 6.5%) if they meet the trust criteria. P2P removes the $5 seller fee entirely and the authentication step in the middle.

**For the buyer:**
No change visible to them. They pay the listing price; the fee math happens behind the scenes between Nomi and the seller.

**For ops at the admin auth step:**
The seller payout that gets credited on authentication reads directly from the order's stored `marketplace_fee` + `processing_fee` columns instead of recomputing from a flat rate. Tier promotions don't retroactively change historical payouts — the `seller_tier_at_sale` snapshot on each order is the source of truth for past transactions.

---

## Auto-promotion: GMV-driven, not application-based

Tier promotions happen automatically when a paid order pushes a seller's lifetime GMV past the next threshold. No application form, no admin approval, no waiting period. The webhook that confirms payment also bumps `profiles.seller_gmv` and recomputes the tier via `tierForGmv()`.

We chose auto-promotion over application-based because:

- The criteria are objective and observable. No judgment call needed.
- Application-based systems incentivize sellers to game the threshold (e.g., split a $1500 sale into multiple smaller orders to "qualify earlier"). Auto-promotion ignores transaction shape and looks only at total volume — harder to game.
- One less manual op for the founder.

Elite is the deliberate exception: it requires manual approval because P2P fulfillment removes our authentication step, which only makes sense for sellers we've manually vetted.

**Demotion:** doesn't happen. A seller who hits $25k once and then stops selling stays Gold. We considered rolling-90-day GMV instead of lifetime, but the messaging gets ugly ("you lost your Gold status this week") and the dollar impact on us is small.

---

## What this costs us

- **Reduced take rate on graded sellers above Basic.** A Diamond seller pays us 7% instead of 9.5% on graded cards — a 2.5-point haircut. Worth it because the volume at that tier is what makes the marketplace work.
- **Engineering time:** the migration + `lib/fees.ts` + threading through every fee surface was about 2–3 days of focused work, mostly in the threading-through and backfill of legacy orders.
- **Ongoing operational:** none. Promotions are automatic; the only manual touch is approving Elite applications.

---

## What this saves us

The savings here are **retention-side**, not direct dollar savings.

- A Diamond seller who would have left for a competitor at 8% stays for the 7% rate plus the trust signal of the tier system itself. Hard to measure precisely but the math is obvious: losing one Diamond seller costs us 7% × their annual GMV. Even one retained seller pays for the entire system.
- The transparent ladder reduces support load. "Why is my fee X%?" becomes self-serve. Every conversation we don't have is operational savings.

---

## What success looks like

- **At least 30% of graded-card GMV** processed by sellers at Pearl tier or above within 6 months. Indicates the ladder is actually attracting and retaining power sellers.
- **<1% of orders ship with a tier-mismatched fee.** The webhook-driven auto-promotion has to be reliable; if a Diamond seller occasionally gets charged the Basic rate, the trust signal collapses. Audited monthly against `seller_tier_at_sale` vs. the seller's tier at the time of fulfillment.
- **No seller asks "how does my tier work?" twice.** The pricing chart + payout calculator on the home page should make the answer self-evident.
- **Elite tier stays small.** It's manual-approval and high-trust; if more than 5–10 sellers are Elite at any time, we've gotten lazy with vetting.

---

## What this is *not*

- **Not a discount on volume.** Sellers don't get retroactive rebates — the rate that applies is whatever their tier was at the time of sale, snapshotted on the order.
- **Not a seller subscription.** No monthly fee, no opt-in. Tier is purely a function of cumulative behavior.
- **Not a tax on small sellers.** Basic tier (9% graded) is the *current* rate for everyone; promotions only lower it. No seller's effective fee goes up under the new system.
- **Not a buyer-visible concept.** Tier is between us and the seller. The buyer sees a price; the fee math is private.

---

## Decisions still open

- **GMV decay.** Right now seller_gmv is monotonically increasing forever. Open question: should it decay (e.g. 90-day rolling) so an inactive Diamond seller eventually re-qualifies? Argument for: keeps tier as a signal of *current* activity. Argument against: punishes long-time sellers who take a break and clobbers retention. Probably worth implementing only if we see Diamond sellers go inactive while keeping the rate.
- **P2P scope.** Currently Elite-only. Open question: should Diamond sellers also be able to opt into P2P (with the trust risk that implies)? Tied to how confident we are in our seller verification layer.
- **Tier-aware seller fee.** Today the $5 ship fee is flat — same for Basic and Diamond. Could imagine waiving it for Pearl+ as another perk. Adds another tuning knob; opted to keep it simple for now.
- **Auto-promotion on chargeback.** What happens if a Diamond seller racks up a chargeback that retroactively pushes their realized GMV below the threshold? Currently nothing; their tier sticks. Probably the right call but worth revisiting if we see abuse.

---

*Last updated: 2026-05-21. Live tier ladder + fee math: see [src/lib/fees.ts](../src/lib/fees.ts).*
