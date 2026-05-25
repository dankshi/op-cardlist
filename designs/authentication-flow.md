# Authentication Flow — Design Summary

> Human-readable version for sharing with stakeholders, partners, or pasting into Google Docs. Decision-and-rationale only; for the technical implementation see [docs/authentication-flow.md](../docs/authentication-flow.md).

---

## What we're building

A redesigned authentication step for cards arriving at Nomi. Today, the admin opens an order, taps "Verify" on each item (no visual feedback), navigates back, and clicks "Mark Authenticated" — there's no concept of "Fake" or "exception," and any non-trivial outcome is captured as a free-text flag that doesn't trigger any downstream automation.

The new flow models authentication as the explicit, branching decision tree it actually is in physical practice — borrowed from StockX and GOAT's playbook, adapted to TCG cards. The first question is binary (Authentic or Fake). The second narrows down (Near Mint or Exception). Each exception type has its own resolution path that automatically triggers the right downstream consequence (consignment, buyout, return, destroy) instead of dumping the order on the admin to figure out manually.

A new order status, **`exception_review`**, holds orders that aren't pure-Near-Mint pass and aren't pure-Fake fail — they're in flight to a specific resolution path.

---

## Why this is worth doing

**1. The current flow has a UX dead-end.** Admins click "Verify" and nothing visible happens. There's no progress indicator, no "now go authenticate" call to action, no concept of what type of issue was found. The first symptom: the user reports "Verify Items isn't working" — it works, but the lack of feedback means it might as well be broken.

**2. We can't notify buyers about issues today.** When something is wrong with an inbound card, the buyer hears nothing until the order either ships or is silently cancelled. A buyer who's paid $1,000 and is waiting on a card deserves an email the moment we know there's a problem — what kind, what we're doing about it, expected timing.

**3. Outcomes need to be automatic, not manual.** When an item arrives that's the wrong card, the seller's card should automatically go into Nomi's consignment inventory and the buyer should be refunded (or reroute). When an item arrives fake, the seller should be given the binary choice of return-or-destroy. Right now every one of these scenarios is a manual ticket in someone's head.

**4. The shape of authentication is the same across every collectibles marketplace.** StockX, GOAT, Loupe, Alt — they all use a near-identical branching tree. Authenticators trained on those platforms will recognize ours instantly. Reinventing the wheel here gains nothing.

---

## How we're doing it

### The flow

```
                    [scan QR / certification code]
                                ▼
                        [Authentic? / Fake?]
                          ▲              ▲
                  Authentic              Fake
                          ▼              ▼
            [Near Mint? / Exceptions?]   ┌── return_to_seller
                ▲              ▲         └── destroy
         Near Mint        Exceptions
                ▼              ▼
          AUTHENTICATED   EXCEPTION_REVIEW
          (ship to buyer)        ▼
                          [pick exception type]
                                ▼
            ┌────────────┬──────────┬─────────────┐
            ▼            ▼          ▼             ▼
      Incorrect Product  Fake   Conditional   Physical Damage
            ▼            ▼          ▼             ▼
      Wrong Card /    return /   Lightly /    Damaged by:
      Slab / Raw      destroy   Heavily       Courier/Nomi/Seller
            ▼            ▼          ▼             ▼
        Consigned                Consigned    Buyout / Buyout /
                                              Consigned
```

Some branches are deterministic — Incorrect Product always lands in consignment because Nomi now owns the wrong card and has to do something with it. Some branches are an authenticator choice — Fake gives the admin a return-vs-destroy toggle so they can match what the seller asked for at intake.

### What changes for each persona

**Authenticator** — opens a dedicated authentication view (separate from the existing intake-receive scanner) where the order's items are listed with a binary Authentic/Fake decision at the top. The reference photos and the seller's listed condition are side-by-side with the physical card. Decisions are sticky-keyboard-shortcutted (A = Authentic, F = Fake, N = Near Mint, E = Exception) to match the GOAT pattern. A status banner at the top — green/red/yellow — surfaces the verdict at a glance for the next person who picks up the package.

**Seller** — for clean Authentic + Near Mint orders, nothing changes (their payout still clears as soon as the order hits `authenticated`). For exception orders, they get an email named after the specific exception: *"Your card was flagged as Wrong Card,"* *"Your card needs a damage decision,"* etc. — with a CTA to choose return vs. destroy when their input is needed.

**Buyer** — gets an email the instant the order hits `exception_review`, telling them exactly what was found and what Nomi will do about it. Today they hear nothing during the gap between "Nomi received" and "shipped to you" — exception orders just sit in limbo. Now they're kept in the loop.

**Admin (you / ops)** — exception_review orders surface in a new section of `/admin/orders` so they can be triaged at a glance. Each exception type has its own action (initiate consignment listing, kick off buyout payment, generate return label) so ops doesn't have to context-switch.

---

## Key design decisions

### Why binary Authentic/Fake first, not condition first

Condition only matters if the card is real. Putting Authentic/Fake first eliminates the "I spent two minutes grading a counterfeit" anti-pattern from sneaker authentication. It also forces the authenticator into the decision they're most legally responsible for (authenticity is fraud; condition is a refund) before any other detail can sway them.

### Why `exception_review` as a new order status

The existing intake-issue table is informational — it logs that something was flagged but doesn't change order state. That made sense when "verify" was the only outcome. With four real exception types each triggering automated downstream actions (consignment, buyout, return, destroy), the order needs a first-class status so:
- the buyer's email template knows whether to say "your card shipped" or "your card had an issue"
- the admin dashboard can group and prioritize exception orders separately
- the inventory system knows whether to expect the card on the consignment shelf or in the return-out queue
- the payout cron knows not to release seller funds on an exception order

### Why Physical Damage attribution matters

If the courier damaged the card, it's our shipping liability and we buy the seller out (we'll claim against the carrier). If we damaged it during intake, same thing — we owe the seller. If the seller shipped a damaged card, that's a seller-side issue and the card goes to consignment at the lower value. Building this attribution into the flow at decision time means the financial consequence is automatic — no separate adjudication step later.

### Why Fake-vs-Return/Destroy is admin choice, not automatic

Some sellers want their fake back (collector value, want to confront the consigner they bought it from). Some want it destroyed (don't want fakes back in circulation). Either is a legitimate ask. The intake flow should capture which the seller said they wanted, but the admin still confirms at authentication time — sometimes the seller changes their mind, sometimes the fake is so egregious that destruction is the only safe option.

### Why consignment is the default exception outcome

Three of the four exception types (Incorrect Product, Conditional, Physical Damage by seller) all end in consignment. The reasoning is uniform: Nomi has the card, it can't be sent to the buyer as-listed, and the most efficient resolution is to sell it ourselves (with accurate listing) and credit the seller the proceeds minus a higher consignment fee. Returning a $30 card to a seller costs more in shipping + labor than the consignment fee earns.

---

## What we explicitly defer

| Item | Why deferred | When to reconsider |
|---|---|---|
| Damage subcategories (Surface / Corners / Edges) at decision time | Captured as free-text for now; can be enumerated later from the data | When we have >100 conditional exceptions and want to surface patterns ("seller X always misgrades corners") |
| Authenticator escrow / four-eyes review for high-value cards | One-operator volume today; a second-look queue costs more in latency than it earns in catch-rate | When we cross >$10k average chase-card value or get burned by an authentication mistake |
| Computer-vision pre-checks against listing photos | The reference image side-by-side in the UI handles 95% of the value; CV is a 6-month project for the last 5% | When we hit volume where humans can't keep up |
| Authenticator performance tracking / accuracy stats | Single-operator today; metrics are vanity until there are multiple people | When we have >2 authenticators |
| Re-grade workflow if seller disputes a Conditional ruling | Manual support ticket for now | When we get >1 dispute per week |

---

## Open questions

- **Should `exception_review` be sub-statused?** e.g. `exception_review.awaiting_seller_response` vs. `exception_review.awaiting_admin_resolution`. Argument for: the seller-action and admin-action queues are very different. Argument against: another layer of state machine to maintain, and the exception_type column already discriminates.
- **What's the SLA on exception resolution?** Today there's no clock. Should an exception_review order auto-buyout if the seller doesn't respond in 5 days? 10? This is a policy question more than a tech one.
- **Do we surface the exception type to the buyer in the email?** Yes for "Wrong Card" (they get a refund and a re-listing offer); less clear for "Heavily Played" (they might want to negotiate a partial refund). Initial cut: yes for all, with the assumption that the buyer prefers transparency over politeness.
