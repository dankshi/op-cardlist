# Raw-card pricing (our market value)

Technical companion to [`designs/raw-pricing.md`](../designs/raw-pricing.md).

## What this is

A second, **transparent** market value for **raw (ungraded) cards**, computed by
us from actual TCGplayer sales — shown *alongside* TCGplayer's own `marketPrice`,
not (yet) replacing it. It is the raw analog of the slab comp engine and reuses
its exact algorithm.

For now we value **Near Mint only**, because TCGplayer's headline market price is
NM — so "ours" and "theirs" are directly comparable.

## Why

TCGplayer's market price is sales-derived but **opaque** (undisclosed window /
weights / outlier rules) and can lag in thin markets. We already scrape real
sold prices into `card_sales` and already run a transparent comp model for slabs
([`docs/slab-pricing.md`](./slab-pricing.md)). Applying the *same* model to raw
NM gives us: one valuation philosophy across raw + graded, confidence/sample
signals TCGplayer doesn't expose, and explicit outlier handling — without
depending on TCGplayer's black box.

Caveat: raw sales currently come only from the TCGplayer feed, so our number
tracks theirs closely. The wins are **consistency, transparency, and control**,
not new signal. Genuinely beating TCG requires multi-source sales (e.g. adding
eBay raw, as we already do for graded).

## Pipeline

1. **Source:** `card_sales` (real sold prices; per-condition/variant/language),
   filtered to `condition = 'Near Mint'`, last 365d.
2. **Algorithm:** `computeVariantValue` in [`src/lib/slab-comp.ts`](../src/lib/slab-comp.ts)
   — recency-weighted trimmed median. Window 90d → widen to 180/365 when thin;
   trim sales outside 0.4×–2.5× the raw median; weight `exp(-ageDays/30)`;
   confidence high (≥8 kept, dispersion <0.25) / medium (≥3) / low / none.
3. **Orchestration:** [`src/lib/raw-comp-recompute.ts`](../src/lib/raw-comp-recompute.ts)
   `recomputeRawValues(admin, { productIds? })` — groups `card_sales` by
   `tcgplayer_product_id` and upserts. No `productIds` = full backfill; with
   them = targeted.
4. **Triggers:**
   - Backfill / manual: `npm run compute:raw-values` (`--dry-run` to preview).
   - Incremental: the sales scraper recomputes the products in each rotation
     window right after writing their sales (scripts/scrape-prices.ts).
5. **Storage:** `raw_market_values` (product-keyed, `condition`), mirroring
   `slab_market_values`. Migration `20260630_raw_market_values.sql`.
6. **Read:** `fetchPrices` + `getCardsByIds` in [`src/lib/cards.ts`](../src/lib/cards.ts)
   join it by product_id and surface it on `CardPrice` as `ourMarketValue` +
   `ourConfidence` / `ourSampleSize` / `ourWindowDays` / `ourTrend30dPct`.

## Where it shows

For now, only the **admin debug "data sources" panel** on the card page (a
`pricing — NM (ours vs TCGplayer)` block with the delta %). This is deliberately
a compare-and-eyeball-drift surface; nothing yet *depends* on our value. Promoting
it to the buy box / portfolio valuation is a follow-up once the drift looks right.

## Tuning

All knobs live at the top of `src/lib/slab-comp.ts` (shared with slabs). Changing
the condition set means generalizing `RAW_CONDITION` in `raw-comp-recompute.ts`
to loop conditions and storing a row per condition.
