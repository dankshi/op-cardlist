# Slab Pricing — Becoming the Source of Truth for Graded One Piece Prices

> Human-readable version for sharing with stakeholders, partners, or pasting into Google Docs. Decision-and-rationale only. The technical companion (schema, algorithms, adapters) lives at [docs/slab-pricing.md](../docs/slab-pricing.md).

---

## The goal

Own the answer to *"what is this graded One Piece card worth?"*

Today we own raw (ungraded) prices well — TCGplayer data flows through a clean `mapping → history → current-price view` pipeline and renders on every card page. Graded slabs are the gap. We already scrape eBay graded sales into `card_graded_sales`, but those sales are shown as a raw list and **never turned into a price**. There is one source (eBay), no aggregation, and no way for a human to remove a bad comp.

The competitors here are PriceCharting and Card Ladder. Both show graded prices (PSA 10, BGS 10, CGC 10) that we currently don't. This plan closes that gap and then overtakes them — because we go to the *original* sources and let humans curate, where they aggregate second-hand feeds and trust them blindly.

---

## The core insight: go to the source, never the mirror

The instinct is "ingest eBay, Alt, and 130point." That's wrong, and understanding why is the whole strategy.

**Alt and 130point are not sources — they are mirrors.** 130point is an eBay-sold-listings search tool. Alt's comps are substantially eBay data re-displayed. If we ingest eBay *and* 130point *and* Alt's eBay-derived comps, we count the same physical sale three times and inflate sample sizes with duplicates.

So the rule is:

> **Ingest primary sources only. A primary source is where a sale actually happened. Never ingest an aggregator that re-reports a source we already have.**

That means:

- **eBay** is the primary source of truth for the bulk of secondary-market slab sales. We go directly to eBay — but **eBay no longer offers API access to sold data**, so "directly" means scraping its public sold-listings pages, permanently. eBay is still *reachable*; it just isn't *stable*. That makes reliable scraping infrastructure (residential proxies, off-datacenter hosting, optionally a managed scraping vendor) a core investment rather than an afterthought — see [the technical doc](../docs/slab-pricing.md#ebay-ingestion-without-an-api).
- **Alt** is ingested *only for Alt-native auctions* — the sales that originate on Alt's own platform and exist nowhere else. We do **not** ingest Alt's eBay-derived comps.
- **130point / Card Ladder / Market Movers** — never ingested. They are competitors and mirrors. At most we study them.
- The other primary sources people actually use — **Goldin, Fanatics Collect (formerly PWCC), Heritage, Whatnot, PSA's own Auction Prices Realized** — are each their own platform where unique sales happen, so each is a candidate adapter.

By going to every primary source and deduplicating the overlap (the same slab sells on eBay and gets re-listed on Alt — one physical card, one comp), **we become the aggregator everyone else wishes they were.** That is what "source of truth" means here.

---

## What we're building, in four layers

1. **One ledger.** Generalize `card_graded_sales` into a source-agnostic `slab_sales` table. Every sale from every source lands here, normalized to the same shape, tagged with its `source` and a curation `status`.

2. **A comp engine.** A nightly job reduces the noisy ledger into **one defensible number** per `(card, grading company, grade)` — stored in `slab_market_values`, the graded analog of our existing `tcgplayer_current_prices`. This is the part that makes us an authority rather than a sales log.

3. **Human curation that sticks.** Admins can filter, exclude, and hand-add sales. Exclusions live on the row and **survive re-scrapes** — the scraper skips rows it's seen, so a removed bad comp stays removed. Curation feeds straight back into the comp engine.

4. **Surfaces.** Graded prices on the card page (per grade chip), correct valuation of graded cards in user portfolios, and a "source of truth" trust signal that shows *which* feeds back each number.

---

## Key decision: how we compute "the price"

A single recent sale is volatile; a naive average is wrecked by one lot listing or one whale. We use a **recency-weighted trimmed median**:

1. Take visible, confirmed *sold* prices for the variant in a 90-day window (widen to 180/365 if thin).
2. Trim outliers — drop anything far from the median (kills bundles, mis-parses, and the occasional outlier whale).
3. Take the median of survivors, weighting recent sales more heavily.

Every value ships with a **confidence** signal (`high` / `medium` / `low` / `none`) based on how many sales backed it and how tightly they clustered. A PSA 10 with 15 tight sales reads "high"; a BGS Black Label 10 with one sale last quarter reads "low" and says so. **Being honest about thin data is itself a trust feature** — it's what PriceCharting gets wrong.

When the machine is wrong or data is too thin to trust, an admin can **pin an override** that wins over the computed value — the same philosophy as the manual-mapping override that already keeps our raw prices correct.

---

## The admin curation tooling (an explicit requirement)

Two new admin surfaces, built on the exact pattern already used for `/admin/mappings`:

**Sale review queue (`/admin/slab-sales`)** — the day-to-day "clean the data" tool:
- Filter by card, source, company, grade, price range, status, and parse confidence.
- See each sale's raw listing title and a link back to the source.
- **Exclude / hide / restore** any sale (with a reason). Bulk-exclude obvious junk (lots, bundles) in one action.
- **Hand-add a sale** — for private deals, Discord sales, or auction results not on any feed.
- Every exclusion immediately corrects the computed value on recompute.

**Source health dashboard (`/admin/price-sources`)**:
- Per-source last-sync time, rows ingested, parse-success rate, and error/challenge counts.
- "Run now" triggers and the value-override editor.

The point of this layer: **our number is better than eBay's raw feed because a human pruned the noise, and the pruning is permanent.** That's the moat.

---

## Phased rollout

**Phase 1 — Schema + comp engine.** Migrate `card_graded_sales` → `slab_sales`; build `slab_market_values` + the nightly recompute; add the override table. Ships graded prices on card pages and *correct portfolio valuation for graded holdings* using the eBay data we already have. No new scraping required to deliver visible value.

**Phase 2 — Admin curation.** The review queue + manual-add + source dashboard. Now we can clean the eBay backlog and the comps visibly improve.

**Phase 3 — Multi-source ingestion + hardened eBay.** The Alt-native-auction adapter, the deduplication layer, and — because eBay has no API and can't run on GitHub Actions' blocked datacenter IPs — moving eBay ingestion onto residential-IP infrastructure (a managed scraping vendor or a self-hosted proxy worker). This is where the "go to every source" strategy becomes real and our coverage exceeds any single competitor.

**Phase 4 — Breadth & tuning.** Add Goldin / Fanatics Collect / Whatnot / PSA-APR adapters as demand justifies; tune confidence; add active-listing fallback for cards with no recent sales. (eBay-ingestion hardening moves up into Phase 3 — there's no API escape hatch to defer to.)

---

## What success looks like

- Every card page shows a defensible graded price per grade with a clear confidence signal — the thing PriceCharting and Card Ladder show and we don't, but done better.
- Graded holdings in user portfolios value correctly (today they're priced at the *raw* TCGplayer number, which is wrong for slabs).
- The same physical sale is never double-counted, even when it appears on multiple platforms.
- An admin can fix a wrong comp in seconds, and the fix is permanent.

## What this is *not*

- **Not blind aggregation.** We deliberately *don't* ingest mirrors (130point, Card Ladder) — more feeds would mean more duplicates, not more truth. (The one exception: *if* eBay ever blocks scraping entirely, we'd promote a single mirror as the only remaining bridge to eBay's data. A fallback, not the plan.)
- **Not a guarantee on thin markets.** Some slabs barely trade. For those we show low-confidence or an admin override, honestly — we don't fabricate precision.
- **Not a one-shot scraper.** The value is the comp engine + curation loop, not the eBay HTML parser (which is fragile and will eventually move to an API).

---

## Decisions still open

- **eBay ingestion infrastructure.** With no API, the choice is *how* to scrape reliably: a managed scraping vendor (handles proxies + CAPTCHAs + HTML drift, modest monthly cost — recommended), a self-hosted worker with residential proxies (cheaper, more maintenance), or scraping our own authenticated Terapeak seller session. All produce identical `slab_sales` rows; it's a cost/maintenance call, not a quality one. What's *not* optional: eBay ingestion can't run on GitHub Actions (datacenter IPs are blocked).
- **How wide in Phase 4.** Which of Goldin / Fanatics Collect / Whatnot / PSA-APR are worth the adapter cost depends on how much unique OP slab volume each carries — a short feasibility spike per source before committing.
- **Active listings as a signal.** For zero-sale variants, do we show the cheapest current *asking* price as a fallback, clearly labeled? Useful but a different kind of number.

---

*Last updated: 2026-06-08. Companion technical doc: [docs/slab-pricing.md](../docs/slab-pricing.md). Builds on the graded-pricing line items marked "Planned" in [docs/PRICE-SCRAPING.md](../docs/PRICE-SCRAPING.md).*
