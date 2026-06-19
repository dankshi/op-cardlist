# BGS (Beckett) integration — plan

Technical companion to [`designs/bgs-integration.md`](../designs/bgs-integration.md).
Bring Beckett (BGS) up to parity with PSA: pull a slab's grade + subgrades from
its **cert**, and ingest **population** counts per card. Mirrors the PSA pipeline
(see [`docs/PSA-POP-MATCHING.md`](./PSA-POP-MATCHING.md)).

## Reality check: no official API

PSA exposes `api.psacard.com`; **Beckett does not publish a public API**. Our PSA
pop ingest already works around this by scraping PSA's *internal* endpoint
(`/Pop/GetSetItems`) with a browser cookie (`scripts/psa-pop-fetch.ts`,
`PSA_WEB_COOKIE`). BGS needs the same scrape approach against two surfaces:

| Need | Beckett surface | Access |
| --- | --- | --- |
| Cert → grade + subgrades + card | **Cert verification / lookup** page (by cert #) | Public page; likely Cloudflare-gated → cookie, like PSA |
| Population per card | **Beckett Population Report** | **Subscription/login-gated** — the main unknown |

So a **research spike** comes first (confirm page shapes + anti-bot), then ship
the lower-risk cert lookup, then population.

## Workstream A — Cert lookup (autofill subgrades)

When a user enters a BGS cert in the grading flow, fetch Beckett's cert page and
return the slab's real grade, four subgrades, and card description.

- **`GET /api/grading/bgs-cert?cert=…`** — server route that fetches Beckett's
  cert lookup, parses `{ grade, subgrades:{centering,corners,edges,surface},
  cardDescription, valid }`. Auth via a `BGS_WEB_COOKIE` in `scraper_settings`
  if Cloudflare-gated (same pattern as the TCGplayer cookie).
- **UI:** a "Look up cert" button in `GradingSubmissionModal` and the
  `ManageHoldingModal` re-grade tab → autofills grade + subgrades + cert. We
  already store all three (`collections.cert_number`, `collections.subgrades`),
  so this only *populates* existing fields.
- **No schema change.** Optionally cache responses in a `bgs_cert_cache` table to
  avoid re-fetching the same cert.

## Workstream B — Population (mirror PSA, ~80% clone)

Per the codebase map, the PSA pop pipeline is the template; little is PSA-specific.

- **`pops_bgs`** table — mirror `pops_psa` (`20260517`): `spec_id` PK, `bgs_set_id`,
  `bgs_card_number`, `card_id` (nullable), `description`, `variety`, `set_code`,
  grade buckets **including `grade_9_5` and Black Label**, `source/mapped_by/
  mapped_at`. Plus `pops_bgs_with_tcg` view and `bgs_ignored_varieties`.
- **`scripts/bgs-pop-fetch.ts`** — clone of `psa-pop-fetch.ts`: fetch per set,
  `autoMatchSpec()` adapted to Beckett's variety naming, upsert to `pops_bgs`.
  Needs the Beckett pop source confirmed (Workstream-B risk).
- **`/admin/bgs-pops`** page + `PATCH /api/admin/pops-bgs/[specId]` +
  ignored-varieties route — clones of the PSA admin surfaces.
- **Read:** extend `getCardPopulations()` (`src/lib/price-history.ts`) to also
  query `pops_bgs` and return a `BGS` bucket. `CardPopulations.tsx` **already**
  renders a BGS column (`Company = 'PSA' | 'BGS' | 'CGC'`), with BGS grades
  (Black Label / 10 / 9.5 / 9 …) in its defaults — no UI change.
- **Automation:** a `update-bgs-pops.yml` workflow + a pg_cron dispatch row, same
  as the sales scraper (`20260628_sales_scrape_cron.sql`), reusing the stored
  GitHub token.

## What's already reusable (no work)

`slab_market_values`, `slab_sales`, `collections.{grading_company,grade,cert_number,
subgrades}`, `GRADING_SCALES.BGS`, `SUBGRADE_*`, and `CardPopulations` all already
support BGS. Grade scale and subgrades shipped with the grading feature.

## Sequencing

1. **Research spike** — verify Beckett's cert page parses cleanly and whether the
   Population Report is reachable with an account cookie (or find an alt source).
2. **Ship A** — cert-lookup autofill. Self-contained, high value, no schema/data
   dependency.
3. **Ship B** — population, pending the spike's pop-source answer; clone the PSA
   migrations/scraper/admin and extend `getCardPopulations()`.

## Open questions

- Does Beckett's cert page expose subgrades in the HTML/JSON, or render them in an
  image? (Determines parse difficulty.)
- Is the Population Report scrape-able with a paid Beckett account, and are its
  set/card identifiers mappable to our `card_id` like PSA's SpecIDs?
