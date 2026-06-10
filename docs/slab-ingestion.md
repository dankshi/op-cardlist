# Slab Ingestion — Technical Design

> How graded-sale data gets *into* `slab_sales` at scale without getting bot-blocked — the ops/architecture companion to [docs/slab-pricing.md](slab-pricing.md) (which covers the data model + comp engine). Human-readable version: [designs/slab-ingestion.md](../designs/slab-ingestion.md).

## Goal

Keep `slab_sales` fresh across every graded-worthy One Piece variant, **faster than competitors who rely on third-party/aggregated feeds**, without tripping eBay's bot defenses. The thesis: we don't out-scrape Card Ladder across all collectibles — we *dominate the One Piece niche* by polling its few-hundred high-value variants frequently and surfacing sales within hours, while generalists run daily batches.

---

## 1. What to scrape — target selection

**Not all ~3,700 cards.** Commons/uncommons almost never trade as slabs. The graded universe is the chase variants (alt-arts, SECs, leaders, manga, SPs) — realistically **a few hundred to ~1,000 variants**. Filter the target set by signal:
- `market_price ≥ threshold` (the scraper's existing `selectTargets`, default $20), and/or
- has `pops_psa` population data, and/or
- high rarity / parallel art style.

**One eBay search per *variant*, not per grade.** A single sold-search (`OP13-118 Red Super Alt`, `LH_Sold=1&LH_Complete=1`) returns all grades; title-parsing buckets them into PSA 10 / BGS 9.5 / etc. So it's ~1 request per target, not per target×grade.

**Per-variant queries, not one bulk pull.** `buildQuery(cardId, tcgName)` anchors on the set code + variant keywords. You can't reliably bulk-fetch "all OP graded sales" in one query — it's too noisy and unattributable. The per-variant anchor is what makes each result cleanly assignable to a `(card_id)`.

## 2. Cadence — incremental, tiered, rotated

**Incremental — only pull *new* sales.** Search sorted by ended-most-recently (`_sop=13`); dedup on `ebay_item_id` (unique partial index) means re-seen sales are ignored on upsert. A future early-stop (break on the first already-stored `ebay_item_id`) makes deep pages free. Each daily poll therefore costs ~1 light request per target and ingests only the 0–5 genuinely new sales.

**Tiered frequency by value** (don't poll a $15 card as often as a $2,000 one):

| Tier | Value | Cadence |
|------|-------|---------|
| 1 | > $200 | every ~4–6h |
| 2 | $50–200 | daily |
| 3 | $20–50 | weekly |

**Rotation.** A worker cron processes a **window of the stalest targets each tick** (the pattern already proven in `.github/workflows/update-sales.yml`'s `SALES_ROTATION_LIMIT`), so the catalog cycles at its tier cadence without a single big burst — which is also gentler on rate limits.

**State required (pending):** a `slab_scrape_targets` table — `card_id` (PK), `tier`, `last_scraped_at`, `enabled` — seeded from the value/pop signals above and updated each run. This is the one remaining pure-code piece; it's coupled to the worker, so it lands with the infra decision.

## 3. The fetch seam — the swappable anti-bot layer (built)

The page-fetch is the fragile, frequently-changing part; the parse is stable. They're now separated in [scripts/scrape-ebay-graded.ts](../scripts/scrape-ebay-graded.ts):

```
SearchFetcher                       (interface: fetchHtml(query) → html)
 ├─ PuppeteerFetcher                (default — local headless puppeteer-extra + stealth)
 └─ HttpEndpointFetcher             (vendor — when EBAY_FETCH_ENDPOINT is set)
        ↓ html
parseSoldSearchHtml(html)           (cheerio; source-independent — same parser either way)
        ↓ RawListing[]
rowsFromRawResults(raw, now, expected)   (grade parse + variant match + confidence)
```

- **Swap to a vendor = one env var.** `EBAY_FETCH_ENDPOINT="https://vendor/?api_key=…&url={url}"` routes through a scraping vendor's residential infra instead of puppeteer; `main()` skips launching the browser entirely.
- **Challenge detection** (`isChallengeHtml`) runs on the returned HTML, so it works for both fetchers.
- The cheerio parser tries legacy (`li.s-item`) and newer (`div.s-card` / `li.srp-river-results-item`) eBay result selectors.

## 4. Anti-bot strategy — how others do it, and what we do

**How the real price aggregators get eBay sold data:** almost none have a clean official feed. eBay deprecated `findCompletedItems`; the **Marketplace Insights API** has sold data but is gated to approved partners; the Browse API exposes only *active* listings. So the industry **scrapes**, behind rotating **residential/mobile proxies**, or pays a **scraping vendor** to. (Some lean on 130point as a free-ish mirror — a competitor + rate-limited, and a *mirror* we deliberately don't ingest; see slab-pricing.md.)

**The techniques that matter, in order:**
1. **Residential/mobile proxies, rotated** — ~80% of it. Datacenter IPs (incl. GitHub Actions, most cloud) are pre-blocked.
2. **Realistic fingerprint** — `puppeteer-extra-plugin-stealth` (hides `webdriver` etc.) + real UA/viewport/`Accept-Language`. Already in place.
3. **Human-like pacing** — randomized/jittered delays, low concurrency, load spread over the day (rotation). Bursts are the #1 tell. *(Current `POLITE_DELAY_MS` is fixed 2.5s — should be jittered.)*
4. **Challenge detection + backoff** — on a challenge: back off, rotate IP, retry later. Detection is in; backoff/rotation is the vendor's job (or the worker's with a proxy pool).
5. **CAPTCHA handling** — solver service, or more commonly just rotate to a fresh residential IP.
6. **Session/cookie reuse** so you're not a cold suspicious session each hit.

**Volume math:** a curated few-hundred-to-1k targets, incremental, tiered, rotated = a few hundred light requests/day. That's low enough to stay under the radar with paced residential requests.

**Build vs buy:**

| Option | What | Trade-off |
|--------|------|-----------|
| **Managed vendor** (Bright Data Web Unlocker, ScraperAPI, Zyte, Oxylabs, Apify, SerpApi eBay engine) | Hand it the URL; it returns HTML, owning proxies + CAPTCHA + fingerprint. | **Recommended start.** Lowest ops; plugs into `EBAY_FETCH_ENDPOINT` today. Modest monthly cost. |
| **Self-hosted** puppeteer-stealth + residential proxy pool on an always-on worker | Run the browser, rent just the proxies. | Cheaper/request, you own the arms race. |
| **GitHub Actions** | ❌ | Datacenter IPs — challenged immediately. Fine for the TCGplayer scrape, never eBay. |

## 5. Data quality / precision (built)

- **Variant matching** ([src/lib/slab-listing-match.ts](../src/lib/slab-listing-match.ts), pure + tested): drops a wrong-variant leak (an explicit alt-art/manga/parallel listing returned for a base-card search → belongs to a different card) and flags the ambiguous case (`special` target, terse title) as low-confidence. Conservative — only hard-drops on a *positive* contradiction.
- **Parse confidence**: lot/bundle/proxy titles → `parse_confidence='low'` → the `/admin/slab-sales` "parse?" badge.
- **Comp outlier trim** (in the comp engine): even a mis-attributed sale gets dropped if it's far from the variant's median — the large base-vs-alt price gap means leaks are caught automatically.
- **Cross-source dedup** ([src/lib/slab-dedup.ts](../src/lib/slab-dedup.ts), pure + tested): cert match (strong) or price+date heuristic (weak, report-only) so a second source can't double-count.
- **Admin curation** ([/admin/slab-sales](../src/app/admin/slab-sales/page.tsx)): the human backstop, with instant recompute.

**Image detection — deliberately later.** Text anchors (printed card ID + grade in title) + the outlier trim + curation cover the large majority. Image work is over-engineering for v1 and hard on slabbed photos. If revisited: a perceptual hash as a *soft confidence signal* on high-value chase variants only; and if any image work happens, prioritize **OCR of the slab label** (cert# + grade) over art-matching — the cert# is the strongest cross-source dedup key and feeds the dedup pass.

## 6. The worker — where it runs (pending infra decision)

- An **always-on worker** (Fly.io / Railway / small VPS) with a cron, or the **vendor's infra** — never GitHub Actions.
- Each tick: select the stalest target window → fetch+parse+match → upsert `slab_sales` → `recomputeSlabCards` for affected cards (which also snapshots `slab_market_value_history`).
- `update-slab-prices.yml` can orchestrate API-friendly sources + the recompute; eBay runs on the worker/vendor path.

## 7. Monitoring

- `slab_source_health` view → [/admin/price-sources](../src/app/admin/price-sources/page.tsx): per-source counts, last-ingested, latest-sale.
- Track **challenge rate** per run; a spike means eBay tightened defenses → rotate IPs / lean on the vendor. (A `slab_scrape_runs` log is the natural place for this — pairs with the rotation table.)

## Pipeline, end to end

```
target window (stalest, by tier)
  → SearchFetcher.fetchHtml (puppeteer | vendor)
  → parseSoldSearchHtml (cheerio)
  → rowsFromRawResults (grade parse · variant match · confidence)
  → slab_sales  (upsert, dedup on ebay_item_id)
  → dedup-slab-sales (cross-source, when ≥2 sources)
  → recomputeSlabCards → slab_market_values (+ slab_market_value_history)
  → card page grade chips · portfolio valuation
curation: /admin/slab-sales (exclude/restore/add) — instant recompute
```

## Build status

| Piece | Status |
|-------|--------|
| Target selection (value threshold) | ✅ `selectTargets` |
| Per-variant query | ✅ `buildQuery` |
| Variant matching | ✅ `slab-listing-match.ts` (tested) |
| Parse-confidence flagging | ✅ |
| Cross-source dedup | ✅ `slab-dedup.ts` (tested) |
| Fetch seam (vendor-swappable) | ✅ `SearchFetcher` + `EBAY_FETCH_ENDPOINT` |
| Cheerio parser | ✅ `parseSoldSearchHtml` |
| Incremental dedup (ebay_item_id) | ✅ |
| Early-stop on seen id | ⏳ minor optimization |
| Jittered pacing | ⏳ |
| Target/rotation state table | ⏳ couples to worker |
| Worker + cron | ⏳ needs infra decision |
| Vendor integration | ⏳ needs vendor choice (env only) |
| Alt adapter | ⏳ needs Alt's data source |
| Monitoring (challenge rate) | ⏳ |

## Open decisions

- **Ingestion path**: managed vendor (recommended — account + `EBAY_FETCH_ENDPOINT`) vs self-hosted proxy worker.
- **Alt's sold-data source** (feed/API vs HTML) before writing the adapter.
- **Tier thresholds + cadences** — tune against the real target count.

---

*Last updated: 2026-06-09. Companion: [docs/slab-pricing.md](slab-pricing.md), [designs/slab-ingestion.md](../designs/slab-ingestion.md).*
