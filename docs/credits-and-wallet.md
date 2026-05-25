# Credits & Wallet

## What it is

Nomi runs a credit-based wallet alongside Stripe card payments. **1 credit = $1 USD.** Sellers earn credits when their sales clear authentication. Buyers can spend credits at checkout in place of (or alongside) a card charge.

---

## The wallet page

Lives at `/wallet`, linked from:
- The avatar dropdown in the top nav (every signed-in user)
- The dashboard's Settings tab

It shows three things:

- **Available balance** — credits ready to spend or cash out today.
- **Pending balance** — credits from sales that have been paid for but not yet authenticated by intake. Pending flips to Available automatically the moment the order is marked authenticated.
- **Recent activity** — the last 50 credit movements with date, type, a short description, and a link to the related order when applicable.

Activity types:
- **Sale credit** — earned from a sale
- **Purchase** — spent at checkout
- **Refund** — credits returned (e.g. from a cancelled checkout)
- **Adjustment** — manual admin tweak or platform corrections
- **Cash out** — withdrawal to a connected bank account

The "Cash out to bank" panel walks users through Stripe Connect Express onboarding the first time they use it. See [wallet-cashout.md](./wallet-cashout.md) for the full cashout flow.

---

## How sellers earn credits

A single sale's timeline:

1. **Order placed.** Buyer pays.
2. **Seller generates label.** Free at this step — no balance change.
3. **Seller ships to platform.** Card in transit.
4. **Platform receives + verifies.** Pending balance reflects the upcoming credit.
5. **Authenticated.** `subtotal − $5 shipping − 9.5% platform fee` lands in the seller's Available wallet as a single credit.

Sellers see the breakdown live on the order page and in their wallet activity.

### Why the $5 isn't deducted earlier

The shipping label costs the platform roughly $5 on Shippo. We charge the seller $5 to cover it, but **the deduction happens at authentication, not at label generation.** This way the seller's wallet never temporarily dips negative between ship-time and authentication — better UX, especially for first-time sellers.

**Tradeoff:** if an order is cancelled, refunded, or never authenticated (lost in transit, flagged at intake, fraud), the platform absorbs the label cost. The seller is never charged for a failed sale.

---

## How buyers spend credits (pay-with-credits)

### What buyers see

If a buyer has any wallet credit, a **Wallet Credits** card appears on the checkout page between Shipping and Payment.

- Shows total available credit.
- Buyer types how much to apply.
- **Apply** confirms the amount; **Clear** removes it.
- The order summary updates live:
  ```
  Subtotal         $100.00
  Wallet credits   -$20.00
  Card total        $80.00
  ```
- The "Pay" button reflects only the card amount.

### Rules

- **Maximum applicable** — whichever is smaller: buyer's wallet balance, or `subtotal − $1`.
- The $1 floor keeps the Stripe charge above their minimum.
- **Fully credit-only checkout is not supported yet** — buyer always pays at least $1 on card.
- Credits are deducted as soon as the buyer hits Apply. If they abandon checkout and come back for the same listing, those credits are auto-refunded back to their wallet.

---

## What the order page shows

**Buyer view of a paid order:**
```
Subtotal         $100.00
Shipping          Free
Wallet credits   -$20.00
Paid on card      $80.00
```

**Seller view of the same order:**
```
Sale price       $100.00
Shipping          -$5.00
Platform fee     -$9.50
Your payout      $85.50    (1:1 credit, lands on authentication)
```

The seller's payout is always `subtotal − $5 − 9.5%`, regardless of how the buyer paid.

---

## Edge cases

**Refunds.** Credits used by the buyer go back to the wallet first; any remaining amount goes back to the card.

**Abandoned checkout with credits applied.** Credits sit on the pending order until the buyer returns to checkout for that listing — at which point they're auto-refunded.

**Failed authentication.** Platform absorbs the shipping label cost. Seller is not charged.

**Audit trail.** The credit ledger is append-only — nothing is ever deleted or edited. A refund is a new row that reverses a spend, so every credit's history is traceable end-to-end.

---

## Cash out to bank

Available now via Stripe Connect Express. $10 minimum; standard ACH free (1-3 days) or instant ($1 fee). First-time cashouts require ~3 minutes of Stripe onboarding (bank account + KYC); after that, two clicks. Full details: [wallet-cashout.md](./wallet-cashout.md).

## What's next (not built yet)

- **100% credit checkout** — skip Stripe entirely when the buyer pays the full amount in credits.
- **Scheduled cleanup** — auto-refund credits on truly-abandoned orders (currently only refunded when the buyer next opens checkout for that listing).
- **Auto-cashout** — "withdraw automatically whenever I hit $X" schedule.
