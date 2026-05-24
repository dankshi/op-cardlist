# Offers — Design Summary

> Human-readable version for sharing with stakeholders, partners, or pasting into Google Docs. Decision-and-rationale only; technical implementation lives across `src/app/api/bids/`, `src/components/marketplace/BidAskSpread.tsx`, `src/components/dashboard/MyOffersGrid.tsx`, and `src/components/home/OfferCarousel.tsx`.

---

## What we're building

A buyer-side market for cards that aren't listed yet. Instead of waiting for a seller to list a card at a price you like, you make an **offer** ("I'll pay $200 for a BGS 10 of OP01-001") and any seller who owns one can accept it on the spot.

Three behaviors:

1. **Place an offer.** Pick raw or graded (with company + grade for slabs), enter a price. A pre-authorization is placed on the buyer's card immediately — funds are reserved but not captured.
2. **Sell into an offer.** Sellers see active offers on the card detail page grouped by variant ("Raw" / "PSA 10" / "BGS 9.5"). Clicking **Sell** captures the buyer's pre-auth, creates the order, and the listing skips the normal "list → wait → sell" wait entirely.
3. **Cancel or expire.** Buyers can cancel at any time (pre-auth released, funds returned). Pre-auths are valid for 7 days; bid auto-expires when the pre-auth would.

Surfaces:

- `BidAskSpread` on the card detail page — make-an-offer form + grouped variant display + the sell-into-offer button.
- `MyOffersGrid` in `/mystuff` → "My Offers" tab — buyer's view of their open offers with cancel.
- `OfferCarousel` on the home page — "Top Offers" discovery surface, top 12 open offers by price for the last 14 days.

---

## Why this is worth doing

Two reasons.

**1. Asymmetric demand.** A card-collectibles marketplace has long-tail inventory: most cards are listed by *somebody*, but not every card, and not at every price/condition variant. Without offers, a buyer who wants a specific PSA 10 of a niche card has no way to register their willingness to pay. Sellers who own one have no signal that there's demand. Offers turn that latent demand into a price-discovery surface.

**2. Inventory liquidity for sellers.** A seller sitting on a graded slab they're not sure how to price benefits enormously from "here's a $X open offer right now" — they don't have to research comps, set a price, list, and wait. One click and they're done. Speeds up listing → sale by an order of magnitude for cards with active demand.

---

## Key design decision: pre-auth at bid time, capture on accept

The big architectural choice is **when the buyer's card gets touched.** Three obvious options:

- **Bid is a "soft promise":** no card collected at offer time. Seller accepts → buyer is notified to confirm payment. Lowest friction at bid time, highest risk that the buyer disappears between "your offer was accepted" and actually paying.
- **Charge immediately:** when the buyer places the offer, money leaves their card and sits in Nomi's escrow. Zero abandonment risk but ties up real cash for 7+ days on every open offer. Buyer experience: bad — same as paying for a thing you don't have yet.
- **Pre-authorize at bid time, capture on accept** (Stripe's `capture_method: 'manual'` on a PaymentIntent). Card is verified, funds are reserved with the issuing bank, but no money moves until the seller accepts. If no one accepts within the 7-day pre-auth window, the hold drops off automatically.

**We chose pre-auth.** The reasoning:

- Soft promises break the seller's experience. The whole point of "click Sell to accept" is that it should *complete the transaction*. If accepting just sends a notification, the seller is back to "list and wait."
- Charging immediately bricks the buyer's card balance for 7+ days per open offer. A power buyer might have 20 open offers; even at $100 each that's $2,000 of locked funds. Pre-auth doesn't actually move the money — it just reserves it.
- Pre-auth handles the "card expired in the meantime" problem implicitly: if the pre-auth fails, the bid never even existed. No partial state.

**The tradeoff this forces:** bid lifetime caps at 7 days (Stripe's standard pre-auth window for cards). Previously bids could live for 30 days. This is a real UX shift and the design doc for users will mention it explicitly. Worth the tradeoff because the alternative is one of the two worse options above.

---

## How it changes the experience

**For the buyer making an offer:**
The first time they place an offer, they enter a card via Stripe Elements (same flow as a normal checkout). Subsequent offers reuse the saved payment method via Stripe's Customer object — one click + price + variant + done. They see a clear notice: "your card is reserved for $X; you won't be charged unless a seller accepts your offer."

**For the buyer whose offer is accepted:**
Immediate charge, immediate order confirmation email. The order shows up in `/mystuff` → Orders just like a normal checkout. From their POV, "the seller accepted" and "the transaction completed" are the same event.

**For the buyer whose offer expires unfilled:**
The pre-auth hold drops off automatically after 7 days. No charge, no notification needed beyond a "your offer for X expired — re-bid?" email. They can re-bid in one click since payment method is saved.

**For the seller browsing offers on a card they own:**
Active offers grouped by variant directly under the listings panel. Click **Sell** on the variant they own → confirmation modal ("you're about to sell your BGS 10 of OP01-001 to BuyerName for $200") → click confirm → order is live, payout pending intake. Skips the entire `/sell` flow.

**For the seller listing normally:**
Nothing changes. The offer system is a parallel surface; the conventional list-and-wait flow is untouched.

---

## What we get auto

- **Card verification** at bid time (failed CVC, expired card, insufficient funds → bid never created).
- **Idempotent accept** — even if the seller double-clicks Sell, the pre-auth can only be captured once. Second call returns a clean "already captured" response.
- **Expiry sweep** — Stripe drops pre-auth holds at the 7-day mark with no action needed from us.
- **Saved payment methods** via Stripe Customer — a buyer's second offer doesn't require re-entering card details.

## What we have to handle manually

- **Mismatched variant** — seller clicks Sell on a "PSA 10" offer but actually owns a "BGS 10". We need a confirmation modal that surfaces the variant explicitly so they catch the mistake before committing.
- **Quantity** — offer is for 1 by default; seller has multiple copies. Today they fulfill one and any remaining copies go through the normal list flow.
- **Buyer cancellation racing seller accept** — if buyer hits Cancel exactly as seller hits Sell, one of the two operations needs to lose. We let the database be the arbiter: the bid row's `status` column is the source of truth, and both operations attempt an `UPDATE ... WHERE status = 'active'`. Whichever lands first wins; the loser gets a clean "this offer is no longer available."

---

## What this costs us

- **Stripe fees:** standard 2.9% + 30¢ on each captured charge, unchanged from regular checkout. The pre-auth itself is free.
- **Stripe Customer API:** free for the volume we're at.
- **Engineering time:** roughly 2–3 days for the full build (schema, bid-creation flow with Elements, accept endpoint with PaymentIntent capture, cancel flow with PI cancel, UI for the new states).
- **Ongoing operational:** none beyond what already exists. The pre-auth → capture path is handled entirely by Stripe; we don't poll or sweep.

---

## What this saves us

The savings here are different from typical "x dollars/month avoided" — they're conversion gains rather than cost reductions.

- **More transactions per browsing session.** A buyer who would have bounced ("nobody's selling this") leaves a bid instead. That bid converts the next time a seller of a matching card visits the page.
- **Faster time-to-list for sellers with chase cards.** A seller who owns a high-demand card today lists, prices it, waits days for a buyer. With offers, the buyer is already waiting. The transaction can close within minutes of the seller arriving.
- **Better pricing signal across the catalog.** Active offers per variant become a published "this is the floor" signal that helps every other seller price more accurately. Indirect, but real.

---

## What success looks like

- **Conversion lift on cards with active offers** — visits to a card page that has at least one offer should convert to a transaction at a higher rate than cards without. Baseline this in the first 60 days.
- **>20% of offers placed get filled or expire** rather than getting cancelled. High cancellation suggests buyers are placing offers they're not committed to (which means our pre-auth UX isn't clear enough about the reservation).
- **Median time from offer-placed to offer-filled, when filled, < 48 hours.** A high-demand offer should land quickly; if it doesn't, sellers aren't seeing the discovery surface.
- **<1% of accept-offer attempts fail because of pre-auth issues** (expired card, insufficient funds, etc.). Failures here are confusing for the seller and frustrating for the buyer.

---

## What this is *not*

- **Not an auction.** There's no time-bound bidding-up, no reserve price, no winning-bid-takes-it. Offers are static prices that any qualifying seller can fill.
- **Not a binding contract between buyer and seller.** The buyer can cancel any time before acceptance. The seller is not obligated to sell. Only when both sides commit (seller clicks Sell, capture succeeds) does it become a transaction.
- **Not visible across cards.** An offer is for one specific card_id and (for graded) one specific (company, grade) pair. We don't fan offers out to "any PSA 10 of any Luffy card" — too noisy and the matching rules get fragile fast.
- **Not a substitute for normal listings.** Offers complement the list-and-wait flow but don't replace it. Sellers with patience and a price expectation should still list; offers are for sellers with inventory looking for the path of least resistance.

---

## Decisions still open

- **Quantity > 1 on offers.** Today: bid is implicitly for one card. A buyer who wants two PSA 10s of the same card has to place two separate offers. May be worth a single offer with `quantity=N` that gets filled in chunks.
- **Counter-offers.** Seller might want to say "I'll take $180" instead of accept-or-decline at $200. Adds a back-and-forth UX layer we've deliberately deferred — accept/decline only for v1.
- **Offer visibility to sellers off the card page.** Sellers who own the card but aren't browsing it have no way to see the offer. A "deals on cards you own" tab in `/mystuff` would surface this without requiring the seller to remember to check.
- **Re-auth before 7-day expiry.** Bids longer than 7 days would require us to cancel + re-auth before the pre-auth expires. Adds backend complexity for an edge case. Punted until volume justifies it.
- **Trust/reputation gating.** Should new buyers (account < 7 days) be limited to a max bid total? Open question that pairs with the Stripe Radar work — first iteration might just inherit Radar's thresholds.

---

*Last updated: 2026-05-21.*
