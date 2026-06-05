# Adding a New Set — Runbook

**This is the authoritative checklist for ingesting a new One Piece TCG set** (OP-xx, EB-xx,
PRB-xx). Follow it top to bottom. The human-readable narrative version lives at
[`designs/adding-a-set.md`](../designs/adding-a-set.md).

> **Golden rule:** the pipeline is *incremental and idempotent by design*. Always pass the series
> ID / `--set` filter so you only touch the new set, and re-running any step is safe. The "Safeguards"
> section explains exactly what is protected from being overwritten.

---

## The pipeline at a glance

| # | Stage | Script | Reads | Writes | When |
|---|-------|--------|-------|--------|------|
| 1 | Cards | `scripts/scrape-bandai-cards.ts` | Bandai cardlist HTML | `cards`, `card_sets` | As soon as cards show on Bandai |
| 2 | Images → R2 | `scripts/backup-images.ts` | `cards.image_url` | Cloudflare R2 + rewrites `cards.image_url` | Right after stage 1 |
| 3 | Box tile image | `scripts/scrape-set-images.ts` | TCGplayer search | `data/set-images.json` | Anytime (sealed box lists early) |
| 4 | TCG discovery | `scripts/discover-tcg-sets.ts` | TCGplayer API + `SET_NAME_MAP` | `tcgplayer_products`, `tcgplayer_sets`, `set_mappings` | **Once TCGplayer indexes the singles** |
| 5 | Card → product map | `scripts/auto-map-tcgplayer.ts` | `cards`, `tcgplayer_products`, `SET_NAME_MAP` | `card_tcgplayer_mapping` | After stage 4 |
| 6 | Prices | `scripts/scrape-prices.ts` | `card_tcgplayer_mapping` | `tcgplayer_card_price_history`, `card_sales` | After stage 5 |

**Two phases, deliberately split:**

- **Phase A — do immediately (stages 1-3):** Bandai is the source of truth for cards + images, and it
  publishes a set's cardlist (often weeks) before release. Get cards, images, and the box tile live.
- **Phase B — wait, then do (stages 4-6):** TCGplayer indexes **singles** only around/after release.
  Running discovery/mapping/prices before that produces a **half-empty, churny
  `card_tcgplayer_mapping`** that you'd then have to re-run and reconcile. Don't do unnecessary work —
  wait until `discover-tcg-sets.ts --report-only` shows the set has products.

  > Note: the **sealed booster box** (stage 3) usually lists on TCGplayer well before singles, so stage
  > 3 succeeding does **not** mean stage 4 is ready. Check for *singles* before Phase B.

---

## Prerequisites

- `.env.local` with `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` for price scraping). All scripts load this automatically.
- Node + `npx tsx` (scripts are TS, run via tsx).

---

## Step 0 — Find the set's identifiers

1. **Bandai series ID** (a 6-digit number). The pattern:
   - `OP-NN` → `569100 + NN` (e.g. OP-16 → `569116`)
   - `EB-NN` → `569200 + NN`
   - `PRB-NN` → `569300 + NN`
   - Verify by opening `https://en.onepiece-cardgame.com/cardlist/?series=<ID>` — it should show the
     set's cards. (If a set hasn't hit the English site yet, see "Asia-site sets" below.)
2. **English release date** — from `https://en.onepiece-cardgame.com/products/`. Used for
   `card_sets.release_date` (drives sort order). A best guess is fine; correct it later if needed.
3. **TCGplayer set slug** — *not needed yet*; you'll confirm it in Phase B via
   `discover-tcg-sets.ts --report-only`. Put a best-guess placeholder in `SET_NAME_MAP` now.

---

## Step 1 — Config edits (3 files)

All three are single-line additions following the existing entries.

**a) `scripts/scrape-bandai-cards.ts`** — add to the `SETS` dict:
```ts
'569116': { id: 'op-16', name: 'OP-16 - The Time of Battle', releaseDate: '2026-06-12' },
```
- English site + English images is the default — **omit** `site`/`englishImages`.
- Only set `site: 'asia', englishImages: false` if the English site doesn't have the set yet (see
  "Asia-site sets" below).

**b) `src/lib/set-names.ts`** — add to `SET_NAME_MAP` (best-guess slug, confirmed in Phase B):
```ts
// CONFIRM slug via `npx tsx scripts/discover-tcg-sets.ts --report-only` before auto-map
'op-16': ['the-time-of-battle'],
```
The value is an **array** — a Bandai set can map to several TCGplayer sets (base + pre-release +
anniversary/event cards). Add those extra slugs once discovery reveals them.

**c) `scripts/scrape-set-images.ts`** — add to `SET_SEARCH_CONFIG`:
```ts
'op-16': { query: 'The Time of Battle Booster Box', matchKeyword: 'time of battle' },
```
`matchKeyword` is optional but helps disambiguate when the search returns multiple boxes.

---

## Step 2 — Phase A: run now (cards, images, box tile)

```bash
# 1a. Dry-run first — confirms the parse + card count look right, no DB writes
npx tsx scripts/scrape-bandai-cards.ts 569116 --dry-run

# 1b. Real run → cards + card_sets (UPSERT, only this set)
npx tsx scripts/scrape-bandai-cards.ts 569116

# 2.  Mirror new card images to R2 + rewrite cards.image_url to R2 URLs
#     (skips images already in R2; --update-db rewrites image_url)
npx tsx scripts/backup-images.ts --update-db

# 3.  Booster-box tile image → data/set-images.json (no npm alias; run directly)
npx tsx scripts/scrape-set-images.ts --set=op-16 --force
```

**Check after Phase A:**
- `card_sets` has the new row with `card_count` ≈ the number Bandai shows.
- `cards` has that many `set_id=<set>` rows; a leader (e.g. OP16-001) has name/colors/rarity/image_url.
- Re-running stage 1 reports "0 reprints skipped" updates, not errors (idempotent).
- `data/set-images.json` has the new set with a `boosterBoxImageUrl`; the homepage tile renders.
- A sampled `cards.image_url` for the set points at the R2 domain (after stage 2).

---

## Step 3 — Phase B: run once TCGplayer has the singles

First confirm the set is indexed and lock in the real slug:
```bash
npx tsx scripts/discover-tcg-sets.ts --report-only   # is <set> listed? what's its slug?
```
If the slug differs from your placeholder, fix `SET_NAME_MAP` (`src/lib/set-names.ts`) and add any
extra slugs (pre-release / event cards). Then:
```bash
npm run discover:sets                            # seed tcgplayer_products / tcgplayer_sets / set_mappings
npx tsx scripts/auto-map-tcgplayer.ts --dry-run  # review proposed card→product matches
npx tsx scripts/auto-map-tcgplayer.ts            # write card_tcgplayer_mapping (source=auto/review)
npm run scrape:prices -- --set=op-16             # price history + recent sales
```

**Check after Phase B:**
- `auto-map --dry-run` reports a healthy match rate; anything it flags `source='review'` shows up in
  `/admin/mappings` for a human to confirm — that's expected, not an error.
- `npm run scrape:prices -- --set=op-16 --card=op16-001 --debug` returns a sensible price for a chase
  card.

---

## Safeguards — what the pipeline will *not* overwrite

These are why re-running is safe and why you won't clobber curated data:

- **Incremental scope.** Passing a series ID / `--set` touches only that set. Everything else is
  untouched (and you avoid hammering Bandai/TCGplayer rate limits).
- **Reprint protection** (`scrape-bandai-cards.ts`). If a card already exists under a different
  `set_id` (e.g. a PRB reprint of an EB card), the original `set_id` is kept.
- **Art-style preservation** (`scrape-bandai-cards.ts`). `art_style` is only *seeded* on brand-new
  cards (`detectArtStyle()` best-guess: parallels → `alternate`, base → `standard`). Rows that already
  have an `art_style` — curated by admin or seeded earlier — are **never** overwritten on re-scrape.
  The finer styles (super alt / wanted / manga) get refined later from TCGplayer product names in
  stage 5 and by manual curation in `/admin`.
- **Mapping protection** (`scrape-prices.ts`). Product IDs already in `card_tcgplayer_mapping` are
  protected from rewrite — the price scraper refreshes *prices*, not mappings.
- **Conflict quarantine** (`auto-map-tcgplayer.ts`). When an auto-match disagrees with an existing
  mapping, it writes `source='review'` (surfaced in `/admin/mappings`) instead of silently
  overwriting a human's `source='manual'` fix.
- **UPDATE-not-UPSERT for partial rows.** Both `scrape-bandai-cards.ts` (art_style seed) and
  `backup-images.ts` (image_url rewrite) use `UPDATE … .in('id', …)` rather than a partial-column
  upsert. A partial upsert would attempt an INSERT of `{id, …}` whose `base_id`/`set_id` are NULL, and
  Postgres checks NOT NULL on the proposed insert row *before* `ON CONFLICT` can turn it into an
  UPDATE — so it fails on any brand-new set. If you add a "patch one column on existing cards" step,
  use UPDATE, not upsert.

---

## Variant → art-style → TCGplayer reference

Bandai encodes parallel/alt arts as an HTML id suffix; we store the suffix in `cards.variant`
(`null` for base) and a derived label in `cards.art_style`.

| Bandai id suffix | `cards.variant` | typical `art_style` | typical TCGplayer name |
|---|---|---|---|
| (none) | `null` | `standard` | (no marker) |
| `_p1` | `p1` | `alternate` | Parallel / Alternate Art |
| `_p2` | `p2` | `alternate`* | Super Alternate Art |
| `_p3` | `p3` | `alternate`* | Red Super Alternate Art |
| `_p4` | `p4` | `wanted`* | Wanted Poster |
| `_r1`, `_r2` | `r1`/`r2` | `standard` | Reprint (PRB sets; same art as base) |

\* The scraper seeds all numbered parallels as `alternate` (plus known wanted/manga overrides in the
`WANTED_CARDS` / `MANGA_CARDS` sets at the top of `scrape-bandai-cards.ts`). The precise super/red-super/
wanted/manga distinction is resolved in stage 5 from TCGplayer product-name markers
(`(Super Alternate Art)`, `(Wanted Poster)`, `(Manga)`, …) and by manual curation in `/admin`.
See [`docs/PRICE-SCRAPING.md`](PRICE-SCRAPING.md) for the full variant-matching deep-dive.

If a set introduces a brand-new wanted/manga chase card, add its id to `WANTED_CARDS` / `MANGA_CARDS`
in `scrape-bandai-cards.ts` so the initial seed is correct.

---

## Asia-site sets (set released in JP/Asia but not yet English)

Bandai's Asia English site (`asia-en.onepiece-cardgame.com`) gets data earlier. To surface a set
before its English release:

1. In the `SETS` entry set `site: 'asia'` and `englishImages: false` (uses Japanese images).
2. When English images go live (check
   `curl -I https://en.onepiece-cardgame.com/images/cardlist/card/<SET>-001.png` → 200), flip
   `englishImages: true` (or drop both flags if the set is fully on the English site) and re-scrape.

All currently-configured sets are on the English site; this branch is only for not-yet-released sets.

---

## Quick copy-paste (fill in the blanks)

```bash
SERIES=569116          # 569100+NN (OP) / 569200+NN (EB) / 569300+NN (PRB)
SET=op-16              # our set id

# Phase A
npx tsx scripts/scrape-bandai-cards.ts $SERIES --dry-run
npx tsx scripts/scrape-bandai-cards.ts $SERIES
npx tsx scripts/backup-images.ts --update-db
npx tsx scripts/scrape-set-images.ts --set=$SET --force

# Phase B (only once `discover-tcg-sets.ts --report-only` shows the set's singles)
npx tsx scripts/discover-tcg-sets.ts --report-only
npm run discover:sets
npx tsx scripts/auto-map-tcgplayer.ts --dry-run
npx tsx scripts/auto-map-tcgplayer.ts
npm run scrape:prices -- --set=$SET
```
