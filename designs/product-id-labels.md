# Product ID Labels — Design Summary

> Human-readable version for sharing with stakeholders, partners, or pasting into Google Docs.
> Decision-and-rationale only; for the technical reference (schema, ZPL, endpoints) see
> [docs/product-id-labels.md](../docs/product-id-labels.md).

---

## What this is

Every card that moves through our operation gets a sticker with a **QR code** on it. Ops scans that
sticker at pack-out to pull up the order, and reads/types the code off it when they're looking for a
specific item by hand. This doc is about **what code goes on that sticker**.

Until now the sticker carried the order item's internal database ID — a long UUID like
`024e6d55-6dd8-4c3c-9e4f-4f6947ea1f2d`. That's fine for a machine to scan, but it's miserable for a
human to read off a label or type into a search box. We've added a short, friendly code instead:
a **9-character `product_id`** like `C7FVG68KM`.

---

## The key decision: generate a new code, don't shorten the UUID

The obvious-looking shortcut is to just **chop the UUID down** — print the last 6–8 characters and
call it the code. We deliberately did **not** do that, and the reason is the whole point of this
change:

- A shortened slice of the UUID is **derived from** the UUID. If two different items happen to share
  the same tail, you're stuck — you can't change one of them without changing the underlying item ID,
  which breaks everything that references it. The collision is **unfixable**.
- An **independently generated** code is decoupled. When you generate one and it happens to clash with
  an existing code, you simply **throw it away and roll another**. That freedom to re-roll is what lets
  us *guarantee* every code is unique.

This is the same pattern established marketplaces use — a stable internal ID plus a separate,
human-facing "product number" that's generated and checked for uniqueness. We followed it.

> **The rule in one line:** uniqueness comes from *generating-and-checking an independent code*, not
> from how long or random the code is. Truncating only makes collisions rarer; generating-and-checking
> makes them impossible.

---

## What the code looks like and why

- **9 characters, "Crockford Base32"** — digits plus uppercase letters, with the ambiguous ones
  (`I`, `L`, `O`, `U`) removed so nobody mixes up `O`/`0` or `I`/`1` reading a smudged label.
- That gives roughly **35 trillion** possible codes. At our volume we will functionally never have to
  re-roll, and even if we did, the system handles it silently.
- The internal UUID is **untouched** — it stays the permanent, behind-the-scenes ID that everything
  else in the database points at. `product_id` rides alongside it purely as the label/lookup code.

---

## What changed for ops

1. **The label is now a 1.25" × 1.25" square** — just the QR code with the `product_id` printed
   underneath it. (It used to be a wider 3.5" × 1.25" strip with the card name on it.)
2. **Scanning** a sticker at pack-out resolves the item exactly as before — the operator notices no
   difference except the codes are shorter.
3. **Searching** by the printed code now works: an admin can type a `product_id` into the order search
   and land on the right order.

> ⚠️ **One transition gotcha:** because the scanner now expects the new short code, **any sticker
> printed before this change** (which carries the old long UUID) **will no longer scan.** If there are
> pre-printed labels still floating around on un-shipped inventory, those items need re-labelling.

---

## Why this was worth doing

A short, unique, human-typeable code is the difference between an operator squinting at a 36-character
string and reading off `C7FVG68KM`. It makes manual lookup actually usable, shrinks the label to a
size that fits on more of our packaging, and — because we generate-and-check rather than truncate — it
does all that without ever risking two items sharing a code.
