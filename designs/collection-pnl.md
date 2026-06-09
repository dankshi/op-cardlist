# Your collection, tracked like a portfolio

Right now your collection knows what you own and what it's worth today. This
turns it into a real portfolio: what you **paid**, what you **sold for**, and
how much you actually **made** — per card and across everything, with a full
history you can scroll through and export.

Think Robinhood, but each "position" is a card instead of a stock. Collectibles
are actually a cleaner fit: every card is a specific physical item, so "which one
did I sell" is never ambiguous.

## What you'll be able to see

- **Cost basis** — what you paid (already tracked, per acquisition).
- **Current value** — market price of what you still hold (already tracked).
- **Realized gain** — once you sell, the profit/loss on that sale.
- **Unrealized gain** — paper profit on what you still own.
- **Total return** — the two combined, like a brokerage account.

## The magic part: sales record themselves

When you list a card from your collection and it **sells through Nomi**, the app
automatically:

1. removes those copies from your holdings,
2. records what they sold for (and the fees), and
3. computes your profit against what you originally paid.

No spreadsheet. "Bought for $40 → sold for $156 → **+$91 after fees**" just
appears. Cards sold off-platform (eBay, in person) you can log by hand.

## Per-card history

Click a card in your collection and you get its whole story as a feed:

```
Jan 10   Bought ×2 @ $40
Mar 02   Bought ×1 @ $52
Apr 15   Graded → PSA 10  (−$25)
May 20   Sold ×1 @ $156 (Nomi)   +$91 realized
─────────────────────────────────────────────
Holding ×2 · cost $80 · value $312 · +$232 unrealized
```

Grading is part of the story too: record what you paid to grade a card and what
it came back as — that cost folds into the card's basis, so your profit math
stays honest.

## The transactions ledger

One page lists **every** transaction across your whole collection — every buy,
grade, and sale — sortable and filterable. And an **export** gives you the
tax-shaped version: date acquired, date sold, proceeds, cost basis, gain/loss,
one row per sale. Hand it to your accountant.

## How it rolls out

- **Phase 1 — Profit tracking.** Sales through Nomi record themselves; your
  collection shows Realized / Unrealized / Total return. This alone makes it feel
  like a portfolio.
- **Phase 2 — History & manual entries.** The per-card activity feed, plus
  logging off-platform sales and grading by hand.
- **Phase 3 — Ledger & export.** The all-transactions page, smarter cost-basis
  options, and the CSV export.

## A couple of choices we made (tell us if you'd rather not)

- When you sell part of a stack you bought at different prices, we count the
  **oldest copies first** (standard, predictable). Down the line we can let you
  pick the exact copy.
- When you sell the **last** copy of a card, it leaves your holdings — but the
  sale stays in your history forever.
- If you sell a card you never logged in your collection, we still record the
  sale; it just won't show a profit until you tell us what you paid.
