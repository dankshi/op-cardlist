# Slab Pricing — Technical Design

> Deep-dive on the graded-card price pipeline: ingestion from multiple primary sources, the comp (market-value) engine, admin curation, and surfaces. The stakeholder-facing rationale lives at [designs/slab-pricing.md](../designs/slab-pricing.md). This doc mirrors the structure of the existing raw-price pipeline documented in [docs/PRICE-SCRAPING.md](PRICE-SCRAPING.md) — read that first if you haven't; the slab pipeline is its graded sibling.

## Goal

Produce one defensible market value per `(card_id, grading_company, grade)`, sourced from every *primary* marketplace where graded One Piece cards trade, curated by admins, and consumed everywhere a price is shown. The graded analog of `tcgplayer_current_prices`.

## Current state (what exists today)

| Piece | Where | What it does |
|-------|-------|--------------|
| `card_graded_sales` table | [supabase/migrations/20260512_card_graded_sales.sql](../supabase/migrations/20260512_card_graded_sales.sql) | eBay graded sold listings: `card_id`, `grading_company`, `grade`, `sold_at`, `price`, `title`, `ebay_item_id`, `listing_url`. RLS = public read, service-role write. Dedup on `ebay_item_id`, fallback natural key `(card_id, title, sold_at, price)`. |
| eBay scraper | [scripts/scrape-ebay-graded.ts](../scripts/scrape-ebay-graded.ts) | Puppeteer + stealth over eBay sold search. Parses company/grade from the listing title, dedups on upsert with `ignoreDuplicates: true`. A scaffold — selectors and title regex have edge cases. |
| Read path | `getCardGradedSales(cardId, days)` in [src/lib/price-history.ts](../src/lib/price-history.ts) | Returns a flat list of recent graded sales for the card page. |
| Display | `CardMainPanel` / `GradeSelector` in [src/components/card/CardMainPanel.tsx](../src/components/card/CardMainPanel.tsx) | Grade chips per variant; sales shown as a list. **No aggregated price per grade.** |

**Gaps:** one source only; sales are never reduced to a price; no human curation; portfolios value graded holdings at the *raw* TCGplayer price (wrong — see `getPortfolioValueSeries` in [src/lib/collection-history.ts](../src/lib/collection-history.ts)).

---

## Architecture

Four layers, each the graded mirror of an existing raw-price concept:

```
                         raw (today)                     graded (this design)
  per-sale ledger    card_sales                      → slab_sales
  source link        card_tcgplayer_mapping          → (card_id is the key; no mapping needed)
  current price      tcgplayer_current_prices (view) → slab_market_values (table, nightly recompute)
  manual override    mapping.source='manual'         → slab_value_overrides
```

### Layer 1 — `slab_sales` (the ledger)

Generalize `card_graded_sales` into a source-agnostic table. Migration sketch:

```sql
-- supabase/migrations/20260622_slab_sales.sql
ALTER TABLE card_graded_sales RENAME TO slab_sales;

ALTER TABLE slab_sales
  ADD COLUMN source          TEXT NOT NULL DEFAULT 'ebay',    -- ebay | alt | goldin | fanatics | whatnot | psa_apr | admin
  ADD COLUMN source_item_id  TEXT,                            -- generalizes ebay_item_id
  ADD COLUMN sale_kind       TEXT NOT NULL DEFAULT 'sold',    -- sold | auction | active_listing
  ADD COLUMN status          TEXT NOT NULL DEFAULT 'visible', -- visible | hidden | excluded
  ADD COLUMN excluded_reason TEXT,
  ADD COLUMN reviewed_by     UUID REFERENCES auth.users(id),
  ADD COLUMN reviewed_at     TIMESTAMPTZ,
  ADD COLUMN cert_number     TEXT,                            -- slab cert # when extractable; strongest cross-source dedup key
  ADD COLUMN parse_confidence TEXT;                           -- high | medium | low (how sure the title parse was)

-- migrate existing eBay rows
UPDATE slab_sales SET source = 'ebay';
UPDATE slab_sales SET source_item_id = ebay_item_id WHERE ebay_item_id IS NOT NULL;

-- new constraint set
ALTER TABLE slab_sales ADD CONSTRAINT slab_sales_status_valid
  CHECK (status IN ('visible','hidden','excluded'));
ALTER TABLE slab_sales ADD CONSTRAINT slab_sales_kind_valid
  CHECK (sale_kind IN ('sold','auction','active_listing'));

-- dedup: prefer cert_number, then (source, source_item_id), then natural key
CREATE UNIQUE INDEX idx_slab_sales_cert       ON slab_sales(cert_number)             WHERE cert_number IS NOT NULL;
CREATE UNIQUE INDEX idx_slab_sales_source_id  ON slab_sales(source, source_item_id)  WHERE source_item_id IS NOT NULL;
CREATE UNIQUE INDEX idx_slab_sales_natural    ON slab_sales(card_id, title, sold_at, price) WHERE source_item_id IS NULL AND cert_number IS NULL;

-- primary read index for the comp engine
CREATE INDEX idx_slab_sales_comp ON slab_sales(card_id, grading_company, grade, sold_at DESC) WHERE status = 'visible';
```

Why these columns:
- **`source`** — lets the comp engine read every feed uniformly and lets the admin UI filter/attribute. The existing CHECK on `grading_company` stays.
- **`status` + `excluded_reason` + `reviewed_by`** — curation lives *on the row*. The comp engine reads only `status='visible'`. Because every scraper upserts with `ignoreDuplicates: true` (already the pattern at [scrape-ebay-graded.ts:398](../scripts/scrape-ebay-graded.ts#L398)), a re-scrape **never resurrects** an excluded sale. Durable curation, no extra bookkeeping table.
- **`cert_number`** — the same physical slab listed on eBay and re-listed on Alt shares a cert #. This is the cross-source dedup key that makes "go to every source without double-counting" actually work. Parse it from titles where present (`PSA 10 ... #12345678`).
- **`sale_kind`** — distinguishes real solds from auctions and (optionally) active asking prices, so the comp engine can weight or exclude by kind.
- **`parse_confidence`** — surfaces shaky title parses to the admin review queue first.

### Layer 2 — `slab_market_values` (the comp engine)

One row per priced variant, recomputed nightly. A real table (not a view) so the card page is a single indexed lookup.

```sql
CREATE TABLE slab_market_values (
  card_id          TEXT NOT NULL,
  grading_company  TEXT NOT NULL,
  grade            TEXT NOT NULL,
  market_value     NUMERIC,        -- the headline number (recency-weighted trimmed median)
  last_sold_price  NUMERIC,
  last_sold_at     TIMESTAMPTZ,
  sample_size      INT NOT NULL,   -- visible solds in the window
  window_days      INT NOT NULL,   -- 90, widened to 180/365 when thin
  dispersion       NUMERIC,        -- coefficient of variation of the trimmed set
  confidence       TEXT NOT NULL,  -- high | medium | low | none
  trend_30d_pct    NUMERIC,        -- (this 30d median / prior 30d median) - 1
  computed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (card_id, grading_company, grade)
);
ALTER TABLE slab_market_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read slab market values" ON slab_market_values FOR SELECT USING (true);
GRANT SELECT ON slab_market_values TO anon, authenticated;
```

**Recency-weighted trimmed median** (the chosen algorithm), implemented in a recompute script `scripts/compute-slab-values.ts` (run as the last step of the slab scrape action):

```
for each (card_id, grading_company, grade) with visible sold sales:
  window = 90d                              # widen to 180/365 if < 3 sales
  sales  = visible solds in window
  med0   = median(prices)
  kept   = [s for s in sales if 0.4*med0 <= s.price <= 2.5*med0]   # trim lots/whales/misparses
  if kept empty: confidence = 'none'; continue
  weights = exp(-age_days / 30)             # recent sales count more (30d half-life-ish)
  market_value = weighted_median(kept by weights)
  dispersion   = stddev(kept) / mean(kept)
  confidence   = 'high'   if len(kept) >= 8 and dispersion < 0.25
                 'medium' if len(kept) >= 3
                 'low'    otherwise
  trend_30d_pct = median(last 30d) / median(prior 30d) - 1
```

Tuning knobs (trim bounds, half-life, confidence thresholds) live as constants at the top of the recompute script so they're easy to adjust without schema changes. Mirrors how `tcgplayer_current_prices` is "just the latest row" — here it's "the curated comp," recomputed rather than selected.

### Layer 2b — `slab_value_overrides` (manual authority)

```sql
CREATE TABLE slab_value_overrides (
  card_id TEXT, grading_company TEXT, grade TEXT,
  value NUMERIC NOT NULL, note TEXT,
  set_by UUID REFERENCES auth.users(id), set_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (card_id, grading_company, grade)
);
```

Readers prefer an override when present, else the computed `market_value` — the same "human can always overrule the machine, and it sticks" philosophy as `card_tcgplayer_mapping.source='manual'`. Use for ultra-thin variants (BGS Black Label 10 that sells once a year) or known-bad computed values pending a data fix.

### Layer 3 — Source adapters

Every adapter shares one contract: **fetch → normalize to the `slab_sales` shape → upsert with `ignoreDuplicates`.** New scrapers live in `scripts/` next to `scrape-ebay-graded.ts` and run as steps in a new `.github/workflows/update-slab-prices.yml` (clone of [update-prices.yml](../.github/workflows/update-prices.yml)), with `scripts/compute-slab-values.ts` as the final step.

**The primary-source-only rule.** A source is eligible only if sales *originate* there. Mirrors are banned because they double-count:

| Platform | Type | Ingest? | Notes |
|----------|------|---------|-------|
| **eBay** | Primary | ✅ (have scaffold) | The dominant secondary market; the bulk of comps. **No API available** — sold data comes only from scraping public sold pages; see [eBay ingestion without an API](#ebay-ingestion-without-an-api). Must run off residential IPs, *not* GitHub Actions. |
| **Alt** | Primary *only for Alt-native auctions* | ✅ partial | Ingest **only** sales that originate on Alt's platform. Do **not** ingest Alt's eBay-derived comps. We already have an Alt fetch pattern in [scripts/scrape-alt-manga.ts](../scripts/scrape-alt-manga.ts). |
| **Goldin** | Primary (auction house) | ⏳ later | Unique high-value lots; partly manual-add at first. |
| **Fanatics Collect** (ex-PWCC) | Primary (auction house + marketplace) | ⏳ later | Weekly/premier auctions + fixed-price; unique volume. |
| **Whatnot** | Primary (live auctions) | ⏳ later | Big for TCG slabs; hard to scrape (live video). Likely manual-add or API if available. |
| **PSA APR** | Aggregator-ish | ⚠️ careful | PSA's own Auction Prices Realized. Itself aggregates eBay+others — only ingest the portion not already covered, or treat as cross-check, not a feed. |
| **130point** | Mirror of eBay | ❌ never | Re-reports eBay solds. Ingesting it double-counts. |
| **Card Ladder / Market Movers** | Competitor aggregators | ❌ never | Study, don't ingest. |

**Deduplication across sources.** When two adapters surface the same physical sale (eBay sale re-listed on Alt), they collapse via, in priority order: (1) `cert_number`, (2) `(source, source_item_id)` is per-source so won't collide — instead a cross-source pass after ingestion matches on `cert_number`, and where cert is absent, a heuristic on `(card_id, grading_company, grade, price, sold_at within 2 days)` flags likely dupes for the review queue rather than auto-merging. Conservative: never silently merge two non-cert sales; surface them to an admin.

### eBay ingestion without an API

eBay does not offer usable API access to sold-listing data. The only path is **scraping the public sold-search pages** — permanently; there's no sanctioned API to graduate to. eBay stays *reachable* but never *stable*, so the eBay adapter is the one piece of this pipeline that needs real infrastructure investment. Three layered options, in recommended order:

1. **Managed scraping vendor (recommended primary).** Route eBay sold-search requests through a service that owns the residential-proxy + CAPTCHA + HTML-drift maintenance (Apify's eBay actor, Zyte, Bright Data, Oxylabs, ScraperAPI). They return raw HTML; our `parseSoldSearchHtml` (cheerio) + `parseGradeFromTitle` / `parsePrice` / `parseEbaySoldDate` in [scrape-ebay-graded.ts](../scripts/scrape-ebay-graded.ts) still do the HTML→`slab_sales` normalization. **The wiring already exists:** set `EBAY_FETCH_ENDPOINT` to a `{url}`-templated vendor endpoint and the scraper routes through it instead of puppeteer. Modest monthly cost, justified for a core data asset.
2. **Self-hosted scraper + residential proxies.** Keep the puppeteer-extra-stealth scraper but add a rotating residential-proxy layer and run it from an always-on worker (Fly.io / Railway / small VPS). Cheaper cash cost, more maintenance.
3. **Terapeak (eBay's own sold-data research tool).** Lives in Seller Hub, available to eBay sellers (free tier with a Store subscription), with ~90d–2y of sold history. No public API, so you scrape your *own authenticated* Terapeak session — far less likely to be blocked because you're a logged-in legitimate seller. Viable if we hold an eBay seller account.

**Critical: eBay ingestion cannot run on GitHub Actions.** Its datacenter IP ranges are aggressively blocked — an Actions host gets challenge pages almost immediately (the scraper already detects them at [scrape-ebay-graded.ts:147](../scripts/scrape-ebay-graded.ts#L147)). eBay must run from residential-IP infrastructure (option 1's vendor provides this; option 2 needs proxies; option 3 runs under a logged-in seller session). TCGplayer and the API-friendly sources can stay on Actions; only eBay moves.

**Contingency — if eBay blocks scraping entirely** (not just the API): relax the no-mirrors rule to promote exactly **one** eBay proxy (130point or Card Ladder) as the canonical eBay bridge — with no direct feed there's nothing left to double-count against — and lean harder on the non-eBay primary sources. This is a fallback, not the plan: a mirror is itself scraping eBay and equally blockable, adds a competitor dependency, and inherits the mirror's coverage gaps and freshness lag.

### Layer 4 — Surfaces

- **Card page** — add `slab_market_values` (+ overrides) to the server fetch in [src/app/(site)/card/[cardId]/page.tsx](<../src/app/(site)/card/[cardId]/page.tsx>) and pass per-grade values into `CardMainPanel`. Each `GradeSelector` chip shows the headline number, sample size, and a low-confidence badge when thin. A "source of truth" tooltip lists the feeds behind the number (trust signal).
- **Portfolio valuation** — `getPortfolioValueSeries` in [src/lib/collection-history.ts](../src/lib/collection-history.ts) currently values *all* holdings at raw TCGplayer prices. Join `slab_market_values` for `collections` rows where `grading_company`/`grade` are set so slabs value correctly. `collections.custom_value` still overrides per-line (already supported).
- **New read helpers** in [src/lib/price-history.ts](../src/lib/price-history.ts): `getCardSlabValues(cardId)` → map of `(company, grade) → value+confidence`; keep `getCardGradedSales` for the sales list.

---

## Admin tooling

Both pages follow the established admin pattern: RSC page + session `is_admin` check + service-role writes + `revalidatePath`, wired into `DATA_LINKS` in [src/components/admin/AdminNav.tsx](../src/components/admin/AdminNav.tsx). Reference implementation: `/admin/mappings`.

**`/admin/slab-sales`** — sale review queue:
- Server-fetch `slab_sales` with filters (card, source, company, grade, price range, status, parse_confidence).
- Row actions → `PATCH /api/admin/slab-sales/[id]`: set `status` + `excluded_reason`, stamp `reviewed_by`/`reviewed_at`.
- Bulk exclude → `POST /api/admin/slab-sales/bulk` with a list of ids.
- Manual add → `POST /api/admin/slab-sales` with `source='admin'`.
- After any write, trigger a targeted recompute for the affected `(card_id, grading_company, grade)` (or mark dirty for the nightly job).

**`/admin/price-sources`** — source health + overrides:
- Per-source last-sync, rows ingested, parse-success rate, error/challenge counts (a small `slab_source_runs` log table, or derive from `slab_sales.created_at` + a runs table).
- Value-override editor → `PUT /api/admin/slab-overrides/[card]/[company]/[grade]`.

---

## Rollout phases

1. **Schema + comp engine.** ✅ Built & **pushed** (2026-06-08, as `20260622`–`20260625` — renumbered from `20260614`–`20260617` after a version collision with parallel work on the remote; migrations are written idempotently as a result). `slab_sales`/`slab_market_values`/`slab_value_overrides`/`slab_source_health` migrations; the comp math lives in [src/lib/slab-comp.ts](../src/lib/slab-comp.ts) (pure, unit-tested in `slab-comp.test.ts`) with DB orchestration in [src/lib/slab-comp-recompute.ts](../src/lib/slab-comp-recompute.ts); `compute-slab-values.ts` is the CLI wrapper. Card-page grade-chip pricing + comp-correct portfolio totals (`holdingMarketPrice`). Runs on existing eBay data — zero new scraping.
2. **Admin curation.** ✅ Built. `/admin/slab-sales` — filter, exclude/restore (single + **bulk**), manual-add, with **instant recompute** (every edit calls `recomputeSlabCards` for the affected card; APIs `POST` / `PATCH /api/admin/slab-sales/[id]` / `POST /api/admin/slab-sales/bulk`). `/admin/price-sources` — per-source ingestion health (the `slab_source_health` view, migration `20260625`) + the **value-override editor** (`POST`/`DELETE /api/admin/slab-overrides`). Both wired into the admin Data nav. (Deeper TCGplayer scraper health stays on the existing `/admin/scraper-hq` + `scraper_runs`.)
3. **Multi-source + hardened eBay.** 🟡 In progress.
   - eBay adapter ([scrape-ebay-graded.ts](../scripts/scrape-ebay-graded.ts)) writes `source`/`source_item_id`, **variant-matches** each listing against the target ([slab-listing-match.ts](../src/lib/slab-listing-match.ts), pure + tested) — dropping a wrong-variant leak (e.g. an alt-art listing returned for a base-card search) and flagging ambiguous ones — and tags shaky/ambiguous parses `parse_confidence='low'`, which the `/admin/slab-sales` queue surfaces with a "parse?" badge (scrape→review loop closed). ✅
   - Cross-source dedup ([src/lib/slab-dedup.ts](../src/lib/slab-dedup.ts), pure + unit-tested; runner [scripts/dedup-slab-sales.ts](../scripts/dedup-slab-sales.ts), `npm run dedup:slab-sales`): finds the same physical sale reported by two sources via cert match (strong) or price+date heuristic (weak). `--apply` auto-hides only cert-confidence dups + recomputes; heuristic matches are report-only for human review. Ready for when a second source lands. ✅
   - **Fetch seam** ([scrape-ebay-graded.ts](../scripts/scrape-ebay-graded.ts)): the page-fetch is isolated behind a `SearchFetcher` — local puppeteer by default, or a scraping vendor when `EBAY_FETCH_ENDPOINT` is set — with a shared **cheerio** parser, so the fragile fetch and the stable parse evolve separately and swapping in a residential-IP vendor (ScraperAPI/Zyte/Bright-Data-style "GET url → HTML") is one env var, not a rewrite. ✅
   - Remaining: the **Alt-native-auction adapter** (needs Alt's actual sold-data source), the **target/rotation state table** (tiered freshness), and the **residential-IP ingestion worker / vendor** (infra decision pending). Because eBay has no API and Actions IPs are blocked, this phase moves eBay off Actions onto a residential-IP path (managed vendor or self-hosted proxy worker — see [eBay ingestion without an API](#ebay-ingestion-without-an-api)). `update-slab-prices.yml` orchestrates the API-friendly sources + the recompute; eBay runs on the worker.
4. **Breadth & tuning.** Goldin / Fanatics Collect / Whatnot / PSA-APR adapters as justified; confidence tuning; active-listing fallback for zero-sale variants.

Phase ordering mirrors the raw-price consolidation discipline (see [designs/tcg-prices-consolidation.md](../designs/tcg-prices-consolidation.md)): additive schema first, code switchover next, drops last; the app works at every intermediate point.

## Known issues & edge cases

- **Title-parse noise.** eBay titles are messy; `parse_confidence='low'` rows route to the review queue. Lots/bundles are the main false positives — the trim bounds + `parseGradeFromTitle`'s "skip if two different grades appear" guard ([scrape-ebay-graded.ts:62](../scripts/scrape-ebay-graded.ts#L62)) catch most.
- **Grade text normalization.** Keep `grade` as TEXT for half-grades. Normalize `'10.0'→'10'` at parse time (already done). BGS Black Label → `grade='10'` with company `BGS` (already special-cased).
- **Cross-source dedup without cert numbers** is heuristic, not exact — never auto-merge; flag for review.
- **Thin markets** legitimately have `confidence='none'`. Show "no recent sales," optionally fall back to an active-listing asking price (Phase 4), clearly labeled — never fabricate a sold price.
- **Portfolio time-series — graded holdings valued at comp.** ✅ Addressed. `slab_market_value_history` (migration `20260627`) accumulates a daily comp snapshot per variant (appended best-effort by `recomputeSlabCards`), and `getPortfolioValueSeries` in [collection-history.ts](../src/lib/collection-history.ts) values graded holdings off that history — falling back to the current comp for dates before a snapshot exists, so the chart *level* is comp-correct immediately and the *trend* sharpens as history accumulates. Raw holdings unchanged (TCGplayer price history). `Holding` carries `gradingCompany`/`grade` so the two paths split cleanly.
- **eBay scraping fragility.** HTML selectors rotate and bot challenges happen, and there's no API to fall back to. The mitigation is infrastructure, not a cleaner source: residential proxies + a managed scraping vendor + off-datacenter hosting. See [eBay ingestion without an API](#ebay-ingestion-without-an-api).

## Open decisions

- eBay ingestion: managed scraping vendor vs. self-hosted proxy worker vs. authenticated Terapeak session — a cost/maintenance tradeoff, not a quality one (all yield identical `slab_sales` rows). Recommend a managed vendor first. Non-negotiable: not on GitHub Actions.
- Which Phase-4 sources clear the unique-volume bar to justify an adapter (short feasibility spike each).
- Active asking-price fallback for zero-sale variants: include, clearly labeled, or omit.
- `slab_market_values` recompute strategy: full nightly recompute (simple, fine at current scale — a few thousand variants) vs. dirty-flag incremental on admin edits (snappier UI). Start full; add dirty-flag if the edit→see-it latency annoys.

---

*Last updated: 2026-06-08. Companion: [designs/slab-pricing.md](../designs/slab-pricing.md). Sibling pipeline: [docs/PRICE-SCRAPING.md](PRICE-SCRAPING.md).*
