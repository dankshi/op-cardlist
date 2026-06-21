# Consignment Flow — Design Summary

> Human-readable version for sharing with stakeholders, partners, or pasting into Google Docs. Decision-and-rationale only; for the technical implementation see [docs/consignment-flow.md](../docs/consignment-flow.md).

---

## What we're building

A way for a seller to hand nomi a pile of cards — a stack of singles, a binder, a box of slabs — and have nomi do **all** the selling work: receive them, verify them, photograph them, price them against live market data, list them under the seller's own profile, and pay the seller as each card sells. The seller never writes a listing, never sets a price, never ships an individual card to a buyer.

The card stays the **seller's property until it sells**. nomi takes a commission on each sale; the rest goes to the seller's wallet. This is consignment, not a buyout — we're not buying the collection up front.

Cards come in three ways:

1. **Ship it in (mail-in).** The seller lists what they're sending in our app first, prints one insured shipping label, and mails the whole batch. When it arrives, our team scans one code and the entire manifest is already in the system — we just confirm each physical card matches.
2. **Drop it off (in-store / events).** The seller shows up with cards and their seller QR code. We scan the QR, then add each card on the spot.
3. **From a failed order (automatic).** When a buyer's order hits an authentication exception (seller shipped the wrong card, or it's in worse shape than listed), shipping that low-value card back to the seller often costs more than it's worth. So instead we consign it for them — same deal, same payout-minus-commission. This used to live in its own separate table; it's now just a third way a consignment gets created (see the design decision below).

For v1 we handle **raw cards** (we condition-check and list them) and **already-graded slabs** (we verify the cert and list them). We are *not* yet offering to grade raw cards on the seller's behalf — that's a later add.

---

## Why this is worth doing

**1. It unlocks the sellers who have the most inventory and the least time.** The people sitting on hundreds of cards are exactly the people who won't list them one at a time. Consignment removes every step of friction between "I have a collection" and "it's for sale on nomi." That's net-new supply we can't get any other way.

**2. We already own the hard parts.** nomi already receives and inspects cards (intake), prints scannable QR labels, computes a fair market value for both raw and graded cards, lists and sells through escrow, and pays sellers through a wallet. Consignment is mostly **wiring those together**, not building from scratch. The amount of genuinely new work is small relative to the supply it unlocks.

**3. It's a margin product.** Because we control the listing, the photos, and the pricing — and because the card is already in our hands when it sells — consignment sales are cleaner and faster to fulfill than ordinary seller-shipped orders, and they carry a consignment commission on top.

---

## How it works

### The flow at a glance

```
   SELLER (ship-in)                         nomi ADMIN
   ───────────────                          ──────────
   Build manifest online ───►  lock + get one insured label
   Mail the batch        ───►  [package arrives]
                                  scan ONE batch QR  ──►  whole manifest loads
                                  confirm each card  ──►  card shows "Pending" in seller hub
                                  photograph + price ──►  publish listing under seller
                                                          card is live for sale
   [card sells] ──────────────►  nomi packs & ships (no seller shipping step)
   seller's wallet credited  ◄──  proceeds minus commission
```

In-store is the same right half of the picture, but instead of scanning a batch QR we scan the **seller's QR** and type/scan each card in live.

### What changes for each persona

**The seller (ship-in)** opens the consignment page, searches for each card by name, says whether it's raw (and its condition) or slabbed (company + grade + cert), and sees our suggested price next to each one. They lock the manifest, print one label, and ship. After that it's hands-off: their **Consignments** tab in the seller hub shows every card moving from *received → pending → listed → sold → paid*.

**The seller (drop-off)** does nothing in advance. They show their seller QR; we do the rest.

**The intake operator** gets the efficient version of GOAT's "store reception." For a mail-in batch, the manifest already exists — so receiving is *scan the batch code, then one click per card to confirm it matches*. They only slow down when a card doesn't match what was declared. For drop-offs, they search the card by name (cards have no barcode) or use card-scan, and confirm. Every confirmed card prints a QR label and immediately appears as **Pending** in that seller's hub — so the seller can see we have it.

**The buyer** sees a normal listing. They never know it's consigned.

### When the declared card and the real card disagree

A seller says "PSA 10," it arrives a PSA 9. Or they list it Near Mint and it's clearly played. Or it's counterfeit. The operator flags it, the item drops into a discrepancy queue, and the seller is notified with the specifics. They choose: **accept the corrected terms** (we list it as what it actually is) or **have it sent back**. Nothing gets listed under false pretenses, and the seller is never silently overruled.

---

## How this is better than the reference (GOAT)

GOAT's flow was our starting point. We deliberately diverged where nomi can be more efficient:

| GOAT | nomi | Why |
|---|---|---|
| Mail-in is "TBD" | Mail-in is the **primary, most efficient path** | Pre-registered manifests turn receiving into scan-and-confirm |
| Operator types every card name at the counter | Mail-in cards are **pre-entered by the seller**; one click to confirm | Moves the data entry to the person who has time for it |
| Toggle between "order" and "consignment" mode | **Consignment-only** surface, no toggle | We never intake orders on this screen — one less thing to get wrong |
| Operator researches a price | **Suggested price auto-filled** from our market data | We already compute fair raw and slab values |
| Standard fulfillment | Consignment sales **skip the seller-shipping step** | The card is already in our hands when it sells |
| Scan a UPC | Cards have no UPC → **search-by-name + card-scan**, and our own QR label after that | TCG reality |

---

## Key design decisions

### One consignment model, three entry points (not two separate systems)

We already had a thing called `consigned_intakes` for cards that ended up at nomi after an order exception. It's tempting to think of that as a *different* concept — but it isn't. In both cases the card stays the **seller's** property, nomi sells it for them, and the seller gets the proceeds minus a commission. It's the same economic deal; the only difference is how the card arrived (the seller chose to consign, vs. a failed order forced it).

So rather than maintain two tables that drift apart, we **merged them**. There's one consignment model with an "origin" marker (`ship_in` / `drop_off` / `exception`). The old exception table is migrated in and dropped. One concept, one admin surface, one payout path — and the same commission rate regardless of how the card came in. (The one thing that *is* genuinely nomi's money — buying a seller out when **we or the courier** damaged a card — stays in its own separate `buyouts` bucket, because that really is different.)

### Reuse, don't rebuild

The whole design is built to lean on systems that already work: intake/receiving, QR labels, market-value pricing, the listing and escrow engine, the seller wallet, and the discrepancy/triage queue. The genuinely new pieces are two database tables, the seller's submission screen, and one admin screen. Everything else is plumbing.

### Solo-operator simplicity

Consistent with how we built [receiving](receive-flow.md): no multi-warehouse routing, no per-station fields, one happy path plus one discrepancy queue. We add complexity only when a real bottleneck shows up.

### Raw and slabs now; grading-as-a-service later

v1 lists what the seller sends — raw cards (condition-checked) or pre-graded slabs (cert-verified). Offering to *grade* raw cards on a seller's behalf is a bigger, separate workflow (costs to capitalize, turnaround tracking) and we're deferring it until sellers ask for it at volume.

---

## What we're explicitly deferring

- **Grading-as-a-service** — nomi submitting a seller's raw cards to PSA/BGS and listing the result.
- **Phone-camera card recognition** — identifying a card from a photo. Search-by-name covers it for now (same call we made on slab ingestion).
- **Upfront buyout** — offering the seller immediate cash instead of waiting for the sale.
- **Seller-printed per-card labels** — for now nomi labels each card at intake.

## Open questions

- **Commission rate** — is the consignment commission the same as our normal sell fee, or its own number? (And does it scale with seller tier?)
- **Unsold cards** — after a card sits for a while, do we auto-reprice it, send it back, or offer a buyout?
- **How hard we verify slab certs** — check the cert against PSA/BGS records when the seller declares it, or only when it physically arrives?
