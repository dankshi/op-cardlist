# Intake Identifiers & Triage Codes — Design Summary

> Human-readable version for sharing with stakeholders, partners, or pasting into Google Docs.
> Decision-and-rationale only; for the technical reference (schema, ZPL, endpoints) see
> [docs/triage-codes.md](../docs/triage-codes.md). Related:
> [designs/product-id-labels.md](product-id-labels.md).

---

## The core idea: two identifiers for two moments

A package's life in our warehouse has two distinct moments, and each needs its **own** kind of code.
Trying to make one code do both jobs is what makes this feel complicated — it isn't, once you split
them:

| Moment | We know… | Identifier | Looks like |
|--------|----------|------------|------------|
| **Receiving** an inbound package | …which *package* this is (maybe the seller) — but not always the order | **Triage code** | `T-7Q3KM9XP` |
| **Packing out** a known item | …exactly which *card* this is, on a known order | **Product ID** | `C7FVG68KM` |

The **product ID** only exists once a package is matched to an order (it lives on the order *item*).
The **triage code** is for the moment *before* that — when a package arrives and we can't match it.

---

## The receiving decision tree

When a package lands on the intake desk, the operator scans, and the system routes on what it can
resolve — cheapest match first:

```
Scan the package
│
├─ It's a product label (C7FVG68KM)?      → wrong desk: that's a pack-out label, not intake
│
├─ It's a triage code (T-7Q3KM9XP)?       → pull up the existing triage package
│
├─ It's an order ID / PON?                → open that order, receive against it
│
└─ It's a tracking number?
   ├─ matches a seller's expected shipment → open that order, receive against it
   └─ no match (reused / invalid label)    → CREATE A TRIAGE PACKAGE
        ├─ we know the seller   → triage type "user_id"  (print T- code + seller)
        └─ we don't            → triage type "no_order"  (print T- code only)
```

The last branch is the one trist raised: **a seller reused an old label or sent an invalid one, so the
tracking number resolves to nothing.** We can't identify the *product* yet — we don't know what it is.
So we identify the *package* instead: we open a **triage package**, print a **`T-` code** sticker, put
it on the box, and set it aside. Later, someone reconciles that triage package to a real order (or to
the house account), and from that point the items flow into the normal product-ID path.

This is exactly the "print a USER ID / Triage code" behavior trist described from GOAT — and we already
had the triage flow; this change just gives it a **human-readable code**.

---

## Why the codes look the way they do

Both codes are **generated and checked for uniqueness** (not chopped down from a database ID), so two
packages can never share one. They use an alphabet with the confusing characters removed (`I L O U`)
so they survive being read off a smudged label.

The triage code carries a **`T-` prefix** on purpose. It does two jobs at once:

1. **For a human:** you can tell at a glance whether you're holding a triage package (`T-…`) or a
   packed item (`C7FVG68KM`) — no guessing.
2. **For the scanner:** the prefix tells the system instantly which kind of code it is, so scanning a
   triage label at the pack-out station gives a clear "wrong label — use Intake" message instead of a
   confusing "not found."

---

## What's printed

Triage stickers are now the same **1.25" × 1.25" square** as product stickers: a QR code, the `T-` code
in large readable type beneath it, then a one-line context note (`NO ORDER` or `SELLER: <name>`) and
the tracking tail. Scanning the QR or hand-typing the `T-` code both pull up the same triage package.
