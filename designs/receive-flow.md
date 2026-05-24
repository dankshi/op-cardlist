# Receive Flow — Design Summary

> Human-readable version for sharing with stakeholders, partners, or pasting into Google Docs. Decision-and-rationale only; for technical implementation see [docs/admin-intake-flow.md](../docs/admin-intake-flow.md).

---

## What we're building

The "middle layer" of every order on Nomi. When a seller ships cards to us, we receive the package, verify every item against what the buyer paid for, and only *then* forward to the buyer. Specifically:

1. **Scan to receive.** One USB barcode scan on the packing slip pulls up the order, marks the package received, and prints a product QR for every item — for the happy-path order, this is the entire interaction.
2. **Verify each item.** For every card in the package, the intake operator clicks **Verify** if it matches the listing, or **Flag** if anything is off (wrong card, wrong condition, missing, damaged, counterfeit, etc.).
3. **Triage anything weird.** Packages that arrive without matching tracking, with reused labels, with no packing slip, or with items not on any order drop into a triage queue. The operator resolves each one by hand with notes + photos.
4. **Block authentication until clean.** An order can't move to "Authenticated" (the state where the seller gets paid and we ship to the buyer) until every item is either verified or has its flag resolved.

We use a USB barcode scanner + thermal label printer at one receiving station, with everything else handled in the browser at `/admin/intake`.

---

## Why this is worth doing

Two reasons.

**1. Trust is the entire product.** A trading-card marketplace where you can pay $1,000 for a card and receive a $5 common is, after one incident, dead. The whole reason buyers pay a 9.5% platform fee instead of buying off raw eBay is the promise that we've inspected the card before it ships. Without a deliberate intake step, the platform is indistinguishable from a more expensive eBay.

**2. Seller accountability has to land somewhere.** Sellers occasionally ship the wrong card, ship a damaged card, or short the buyer on quantity. These can be honest mistakes or deliberate fraud. Either way, we need a permanent record of what arrived, who handled it, and what was done about it — so payout disputes have a paper trail and chronic offenders can be identified and offboarded.

---

## How it changes the experience

**For the buyer:**
Nothing they see directly. The order moves through `seller_shipped → received → authenticated → shipped_to_buyer` on the buyer's order detail page. The `received` and `authenticated` states are the new ones — they make it visible that something is happening between "the seller shipped" and "I got it," which buyers actually appreciate ("at least someone checked it").

**For the seller who ships a clean order:**
Nothing changes. They generate a label, print the packing slip, drop the package off. Seller's wallet is credited 1–2 days later when the order hits `authenticated`. Most orders are this case.

**For the seller who ships the wrong card or a damaged item:**
We flag it at intake. The order doesn't authenticate. Their payout is held while we resolve the issue (request a replacement, partial refund the buyer and pay the seller the smaller amount, or cancel and refund entirely). The seller sees this on their dashboard with the flag reason visible.

**For the intake operator (today, the founder):**
Happy path is one scan + one click per item. Exceptions drop into the triage queue. Day-to-day this is a 30-second-per-package workflow on the happy path, more for flagged items.

---

## Key design decision: solo-operator simplicity, not warehouse-grade workflow

There's an industry-standard intake flow for this kind of marketplace — built by warehouses with dozens of operators, separate stations, structured damage-attribution enums, bypass sentinel barcodes, and packing-order-number fields parallel to tracking-number fields. The full reference spec has roughly five distinct branches off the happy path, each with its own UI and database tables.

**We're building the one-branch version.** Happy path or triage queue, nothing in between.

The reasoning:

- Today, intake is one person at one station running about 5–20 packages a day. The five-branch warehouse flow earns its complexity at >50 packages a day with multiple operators. We're not that yet and don't need to plan for it now.
- Most edge cases (reused label, no packing slip, ambiguous tracking match, mystery card) share the same operator action: "look at the package, decide what it is, write a note." Funneling all of them into one triage queue with notes + photos preserves that flexibility without forcing the operator through five different UIs.
- The cost of adding the deferred pieces later (structured damage attribution, station IDs, parallel PON input, etc.) is small — schema columns and a couple of UI changes. The cost of building them now is real ongoing maintenance.

**Revisit if:** intake exceeds 50 packages/day, or we add a second physical receiving station, or we hire a dedicated ops person. At any of those points the simple model starts costing real time.

---

## What gets flagged

The flag dropdown forces a category so we can spot patterns over time:

- **Wrong Card** — the card in the package isn't the card on the listing
- **Wrong Condition** — the condition doesn't match what was listed (e.g., listed NM, arrived with edge wear)
- **Missing Item** — an item on the order wasn't in the package
- **Counterfeit** — the card appears fake
- **Damaged in Transit** — courier damage, distinct from a card the seller knew was damaged
- **Wrong Quantity** — fewer (or more) copies than the listing said
- **Other** — anything else, with a free-text note

Resolutions branch into seven options ranging from "request replacement" to "full refund + cancel" to "accept anyway" (when the disagreement is borderline and we err in the buyer's favor without penalizing the seller).

---

## What this *doesn't* try to do

- **Not grading.** We're verifying the *listed* condition, not assigning grades. A card listed and verified NM stays "NM" — we don't upgrade or downgrade it.
- **Not deep authentication.** We catch the visible fakes (wrong card stock, wrong colors, obvious print issues). Sophisticated counterfeits would need a dedicated authentication step (PSA-style certificate of authenticity) which we don't offer.
- **Not seller risk-scoring.** Chronic offenders surface from the issue history but the system doesn't auto-ban or auto-throttle them — that's a manual call for now.
- **Not condition disputes between operators.** Single-operator volume means we don't need a "second opinion" path. When we add a second intake person this will need re-thinking.

---

## What this costs us

- **Engineering time:** the system shipped over roughly a week of focused work — database changes, the intake page, the triage queue, the issues dashboard, the audit log, the packing-slip route.
- **Hardware:** one USB barcode scanner (~$30) and one thermal label printer (already on hand). No per-package consumables beyond labels.
- **Ongoing operational time:** ~30 seconds per happy-path package, a few minutes per flagged item. At 20 packages/day with a 5% flag rate, that's about 10 minutes/day of intake work.

---

## What this saves us

The savings are harder to attach precise dollar values to than the Stripe Radar piece, but the rough shape:

- **Avoided chargebacks from "item not as described" disputes.** Industry baseline for these is ~0.3% of marketplace volume on uncontrolled platforms. Even at 100 orders/month averaging $200, that's $60/month in avoided chargebacks plus the dispute fees and reputational compounding.
- **Avoided refund-and-return shipping costs.** When a wrong card ships to a buyer, we eat the return shipping in both directions. Catching it at intake means we only ship to the buyer once — once a correct card is in hand.
- **The trust delta.** This is the big one and the unmeasurable one. The reason a buyer pays a 9.5% platform fee instead of buying the same card on eBay is the verification step. Without it, the entire pricing model collapses. Effectively the receive flow is what's *making* the platform fee defensible.

---

## What success looks like

- **>90% of orders clear intake via the happy path** (single scan + click-through verification, no flag, no triage). If this dips below 90% something is wrong upstream — seller mistakes, address confusion, or our matching logic.
- **Triage queue stays under 5 items/day** at current volume. Growing faster than overall volume suggests we need to invest in upstream changes (better packing-slip enforcement, seller education, etc.).
- **Zero unauthenticated cards reach the buyer.** Every shipment to a buyer comes from an `authenticated` order, no exceptions. If this ever fails the cause is a system bug, not policy.
- **Audit trail is fast.** "What happened with order X?" should be answerable in under 60 seconds from the activity log without digging through commits or DM history.

---

## Decisions still open

- **Structured damage attribution** (courier vs. seller packaging vs. internal handling). Right now this lives in free-text notes. We'll backfill into an enum the first time someone seriously asks "what % of damage is courier-caused?"
- **Multi-operator support.** When a second person handles intake we need station IDs on the audit log and a more deliberate handoff for partially-verified orders.
- **Photo SLAs.** Currently photos at intake are optional. For high-dollar items we may want them required (and required before authentication can proceed).
- **Seller-visible "what happened" panel.** Today flagged issues are surfaced to the seller as a status + notes blob. A more structured panel ("here's the photo we took, here's the resolution we picked") would reduce back-and-forth on disputes.

---

*Last updated: 2026-05-21. Live workflow and engineering details: see [docs/admin-intake-flow.md](../docs/admin-intake-flow.md).*
