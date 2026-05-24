# TCGplayer Prices Consolidation — Design Summary

> Human-readable version for sharing with stakeholders, partners, or pasting into Google Docs. Decision-and-rationale only; the migrations live at `supabase/migrations/20260535-20260537_consolidate_tcg_prices*.sql`, with downstream readers in `src/lib/cards.ts` (`fetchPrices`), `src/lib/price-history.ts`, and the scraper at `scripts/scrape-prices.ts`.

---

## What we changed

Collapsed four tables that each stored a slightly-different version of "what does this card cost on TCGplayer" down to a clean three-table model with one source of truth.

**Before:**

| Table | Keyed by | Held | Written by |
|-------|----------|------|------------|
| `tcgplayer_products` | product_id | catalog **+ current prices** | `scrape-all-sets.ts` |
| `tcgplayer_card_prices` | **card_id** | current prices **+ last_sold** | `scrape-prices.ts` |
| `tcgplayer_card_price_history` | (product_id, date) | daily snapshots | `scrape-prices.ts` + backfill |
| `card_tcgplayer_mapping` | card_id | `card_id` ↔ `product_id` link | `auto-map-tcgplayer.ts`, `/api/mappings` |

**After:**

| Table | Keyed by | Held | Written by |
|-------|----------|------|------------|
| `tcgplayer_products` | product_id | catalog **+ last_sold** | `scrape-all-sets.ts` |
| `tcgplayer_card_price_history` | (product_id, date) | **all prices** (current = latest row) | `scrape-prices.ts` + `scrape-all-sets.ts` + backfill |
| `tcgplayer_current_prices` | product_id (view) | latest row from history per product | (computed) |
| `card_tcgplayer_mapping` | card_id | `card_id` ↔ `product_id` link | unchanged |

`tcgplayer_card_prices` is gone entirely. The market price columns on `tcgplayer_products` are gone too. Prices live in exactly one place: `tcgplayer_card_price_history`. A view exposes "the latest row per product" for convenience.

---

## Why this was worth doing

One reason, expressed three ways:

**Stale-price bugs.** `tcgplayer_card_prices` was keyed by `card_id` but held *product-level* data — market price, lowest price, listings count. When `card_tcgplayer_mapping` was corrected (e.g. the auto-mapper initially picked the base print, then a later run picked the SP variant), the price row kept the previous product's price until the next scrape. The user-visible symptom was the EB03-031_p2 case: a Vinsmoke Reiju SP listed at $215 on TCGplayer but our site showed $9.39 (the base print's price from a week earlier).

The structural cause was unavoidable as long as a card-keyed table stored product-keyed data. **Fixing the mapping in one table and the price in another created a window where they could be out of sync.** The consolidation makes that impossible: prices follow the mapping by construction — change the mapping, the next page render shows the new price.

Three different framings of the same idea:

1. **Single source of truth.** One table holds prices. Everyone reads from there (via the mapping for card-keyed views).
2. **No denormalization.** The card-keyed `tcgplayer_card_prices` row was a cached projection of `mapping → product price`. Caches go stale; the join doesn't.
3. **The historical table was already correctly keyed.** `tcgplayer_card_price_history` had always been keyed by `(product_id, date)`. We just acknowledged that the latest row of history IS the current price, and stopped storing the current price separately.

---

## How it changed reads

Before, `fetchPrices()` in `src/lib/cards.ts` read from `tcgplayer_card_prices` keyed by card_id, then joined `card_tcgplayer_mapping` for the TCGplayer URL/name. Two queries, one table cached against the other.

After: three queries that join cleanly by product_id.

```
card_tcgplayer_mapping             → product_id, url, name, source
   ↓ join on product_id
tcgplayer_current_prices (view)    → market, lowest, median, listings, date
   ↓ join on product_id
tcgplayer_products                 → last_sold_price, last_sold_date
```

Each query independent, parallel, cacheable. No "where might this price be wrong if the mapping changed yesterday" thinking required.

---

## How it changed writes

Before, every scrape had to update *two* places (card_prices for current, history for the trail). After: history is the only target. The current-price view is computed on read.

- `scrape-prices.ts` now writes price snapshots only to `tcgplayer_card_price_history`. The old `tcgplayer_card_prices` write is gone.
- `scrape-all-sets.ts` now writes catalog metadata to `tcgplayer_products` (no prices) and appends today's prices to `tcgplayer_card_price_history`. The old price columns on `tcgplayer_products` are gone.
- `backup-images.ts` and the listing flow are unchanged — they didn't touch prices.

---

## Key design decision: keep `tcgplayer_card_price_history` as the home of prices, not move them onto `tcgplayer_products`

When we were planning the consolidation, the obvious alternative was to keep prices on `tcgplayer_products` and drop history's role as a source-of-truth. That would have been simpler (no view needed, one less join). We rejected it.

The argument for keeping prices in history:

- **History was already correct.** It's keyed by product_id + date. Adding "current is just the latest row" required no schema change to history, only a view.
- **`tcgplayer_products` is supposed to be catalog metadata.** Holding current prices alongside the name/set/rarity blurred the responsibility. After the consolidation, products is purely "what is this product" and history is purely "what does it cost." Clean separation.
- **The view is cheap.** `DISTINCT ON (tcgplayer_product_id) ... ORDER BY product_id, recorded_date DESC` over the history table is O(log n) per product with the PK index. For 6,000 products and ~90 history rows per product (the 90-day window we backfilled), the view returns in a few ms.
- **Materializing later is easy.** If the view ever shows up as a real cost in EXPLAIN, we can swap it for a materialized view refreshed at the end of each scrape. No reader code changes.

---

## Migration phases

Three migrations applied in sequence to avoid breakage:

**Phase 1 (additive, no behavior change):** `20260535_consolidate_tcg_prices_phase1.sql`
- Add `last_sold_price`, `last_sold_date`, `sales_scraped_at` columns to `tcgplayer_products`
- Backfill those from `tcgplayer_card_prices` via the mapping
- Create the `tcgplayer_current_prices` view

**Phase 1.5 (data backfill):** `20260536_backfill_price_history.sql`
- Insert today's snapshot from `tcgplayer_products` into `tcgplayer_card_price_history` for every product with price data
- ON CONFLICT DO NOTHING so we don't overwrite real scrape rows from earlier the same day
- This is what makes the view return useful data on day one — without it, products without recent history would show NULL

**Phase 2 (code switchover):**
- Updated `src/lib/cards.ts fetchPrices()`, `src/lib/price-history.ts`, `/api/prices`, `/api/mappings`, `scripts/scrape-prices.ts`, and `scripts/scrape-all-sets.ts` to use the new sources

**Phase 3 (drops):** `20260537_consolidate_tcg_prices_phase2.sql`
- Drop `tcgplayer_card_prices` table
- Drop `market_price`, `lowest_price`, `median_price`, `total_listings` columns from `tcgplayer_products`

The phase split matters because (1) and (1.5) shipped before the code change and (3) shipped after. At every intermediate point, the app worked.

---

## Bonus bug fixed in passing

`src/lib/price-history.ts` had three queries reading `tcgplayer_card_prices.tcgplayer_product_id` — a column that had been dropped *back in migration 20260528*. The functions (`calculatePriceChange`, `getCardPriceHistory`, `getCardSales`) had been silently returning `null` for every card since that date. The 7-day price-change badge on the card detail page was dead. Fixed in the same change set by switching those queries to read product_id from `card_tcgplayer_mapping`.

---

## What this cost us

- **Engineering time:** one focused day across the migrations + code switchover + the two cleanup commits.
- **Coordination risk:** the migrations had to apply on a remote already running ahead of my local copy (the user had unsynced migrations at higher numbers). Sorted by renaming my migration to the next sequential number.
- **One backfill script** (`scripts/_backfill-tcgplayer-name.ts`, deleted after running) to fix 151 stale `tcgplayer_name` rows that had accumulated separately from this issue.

---

## What this saves us

- **The stale-price bug class is gone.** Not "less common" — gone. Cards always show the price of whatever product they're mapped to right now.
- **Scraper simplicity.** Two scripts (`scrape-all-sets.ts`, `scrape-prices.ts`) used to write the same data to different tables. They still both run but the responsibility is now clean: products = catalog, history = prices, mapping = the join.
- **Easier to reason about.** "Where does this price come from?" is now answerable in one sentence. Before, the answer depended on whether the card had a mapping yet, whether the scraper had run since the last mapping change, and which table you happened to query.

---

## What success looks like

- **Zero "wrong price" support tickets** stemming from stale mappings. (The mechanism that caused them is gone.)
- **Price-history badge on card detail pages renders correctly.** It hadn't since migration 20260528; should now Just Work.
- **Schema is more legible to a new engineer.** "Look at history for prices, mapping for which card it is" — done.

---

## What this is *not*

- **Not a price-data-quality improvement.** TCGplayer's API still returns whatever it returns; we still snapshot it without question. If TCGplayer reports a wrong price for a product, we'll show a wrong price.
- **Not a performance optimization.** The new query path has slightly more joins than the old one. Performance is fine but it isn't *faster* — just *correcter*.
- **Not the end of the scraper duplication.** `scrape-all-sets.ts` and `scrape-prices.ts` still hit TCGplayer's API independently for largely-overlapping data. Merging them is a deferred follow-up.

---

## Decisions still open

- **Merge `scrape-all-sets.ts` and `scrape-prices.ts`.** After the consolidation they have cleaner ownership (catalog vs. card-side prices + sales) but still duplicate API calls. Worth one daily script that does both passes once.
- **Materialize `tcgplayer_current_prices`.** Today it's a view. If `EXPLAIN ANALYZE` ever shows it as a hotspot, swap to a materialized view refreshed at end-of-scrape.
- **Retention policy on `tcgplayer_card_price_history`.** Today we keep every snapshot forever. At ~3.7k cards × 365 days = 1.3M rows/year, not a problem yet. At some point we'll want a rollup (weekly averages for >90 days, monthly for >1 year, etc.).

---

*Last updated: 2026-05-21. Live readers: see [src/lib/cards.ts fetchPrices()](../src/lib/cards.ts#L121) and [src/lib/price-history.ts](../src/lib/price-history.ts).*
