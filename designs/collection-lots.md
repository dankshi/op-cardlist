# Tracking what you actually paid — collection "lots"

## The problem

If you own three copies of the same card, you probably didn't pay the same
price for all three. Before, a card in your collection had **one** "price paid"
and **one** "acquired date" for the whole stack — so your portfolio's cost
basis (and therefore your gain/loss) was only ever an approximation once you
owned more than one.

## What changed

Each card in your collection can now hold several **acquisitions** ("lots").
Every acquisition records its own:

- **quantity** — how many you bought that time
- **price paid** (per card) — optional
- **date acquired** — optional

So "Ms. All Sunday — raw Near Mint" might be:

```
2 copies  @ $40  bought Jan 10
1 copy    @ $52  bought May 2
─────────────────────────────
3 copies · cost basis $132 · value $156  (+$24)
```

Your portfolio totals and gain/loss now reflect what you really spent.

## Where you do it

On a card's page, the **In your collection** panel has an **Edit** button (and
an **Add another** row). Both open the collection editor, which now has an
**Acquisitions** section:

- Each acquisition is its own row: a quantity stepper, a price box, and a date.
- **Add another acquisition** adds a row — log each separate purchase.
- Remove a row with the ✕; removing the card entirely is still the **Remove**
  button.

Quick adds (the one-click "Add to collection", and the `+ / −` stepper on the
panel) still work with no price — those land in a single "loose" pile, and you
can fill in prices later via Edit.

## What stays the same

- The panel still shows one line per **grade/variant** (raw, PSA 10, …) with the
  rolled-up quantity, value, and total cost basis. The individual acquisitions
  live inside the Edit screen.
- Cards added automatically when a Nomi purchase is delivered still record the
  price you paid, as their own acquisition.
- A card's **grade** is chosen when you first add it. To change a grade, remove
  the card and re-add it.
