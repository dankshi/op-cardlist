# Architecture

> **Adding a new set?** Follow the runbook: [docs/adding-a-set.md](adding-a-set.md)
> (human-readable summary: [designs/adding-a-set.md](../designs/adding-a-set.md)).

## Data Sources

| Data | Where | Written By |
|------|-------|------------|
| Card catalog (names, rarity, images, effects) | Supabase `cards` + `card_sets` tables | `scripts/scrape-bandai-cards.ts` (from Bandai) |
| Card images (mirrored) | Cloudflare R2 (`cards.image_url` rewritten to R2) | `scripts/backup-images.ts --update-db` |
| TCGPlayer product catalog + set discovery | Supabase `tcgplayer_products`, `tcgplayer_sets`, `set_mappings` | `scripts/discover-tcg-sets.ts` |
| Card → TCGPlayer product mapping (single source of truth) | Supabase `card_tcgplayer_mapping` | `scripts/auto-map-tcgplayer.ts` (auto) + `/admin/mappings` (manual) |
| Prices + recent sales | Supabase `tcgplayer_card_price_history` + `card_sales` | `scripts/scrape-prices.ts` |
| Booster-box tile images | `data/set-images.json` | `scripts/scrape-set-images.ts` |
| TCGPlayer sealed products | `data/products.json` | `scripts/scrape-products.ts` |
| PSA grading populations | Supabase `pops_psa` table | `scripts/psa-pop-fetch.ts` |

## How It Works

1. **Card catalog** is scraped from Bandai's official site per set and UPSERTed directly into Supabase `cards` + `card_sets`. The scraper is incremental — pass set series IDs to scrape only those sets without touching the rest. Reprint protection: if a card is already in the DB under a different `set_id` (e.g. a PRB-02 reprint of an EB01 card), the original set_id is preserved. Card images are then mirrored to Cloudflare R2 by `backup-images.ts --update-db`, which rewrites `cards.image_url` to the R2 URLs.
2. **Card → product mapping** lives in Supabase `card_tcgplayer_mapping` — the single source of truth linking a `card_id` to a `tcgplayer_product_id`. It's written by `auto-map-tcgplayer.ts` (`source='auto'`/`'review'`) and by manual fixes in `/admin/mappings` (`source='manual'`).
3. **Prices** live in Supabase `tcgplayer_card_price_history` (daily snapshots) and recent transactions in `card_sales`. `scrape-prices.ts` reads the mapping table, refreshes prices, and **does not overwrite** existing product-id mappings.
4. The app reads card metadata + current prices from Supabase at request time, cached per-request via React `cache()` in [src/lib/cards.ts](../src/lib/cards.ts).
5. The `/admin/mappings` page lets staff fix wrong card→product mappings; fixes write `source='manual'` to `card_tcgplayer_mapping` and are protected from being overwritten by the auto-mapper.

## Daily Pipeline

```bash
npx tsx scripts/scrape-bandai-cards.ts           # 1. Card catalog from Bandai → cards + card_sets tables
npx tsx scripts/auto-map-tcgplayer.ts            # 2. Refresh card → product mappings → card_tcgplayer_mapping
npx tsx scripts/scrape-prices.ts                 # 3. Prices from TCGPlayer → tcgplayer_card_price_history + card_sales
```

For a **new set release**, see the full runbook ([docs/adding-a-set.md](adding-a-set.md)). In short — pass the series IDs to scrape only those, then mirror images:

```bash
npx tsx scripts/scrape-bandai-cards.ts 569116         # scrape only OP-16
npx tsx scripts/backup-images.ts --update-db          # upload new images to R2 + rewrite cards.image_url
```

## /admin/mappings Page Safeguards

The mapping fix page has multiple layers of protection against bad assignments:

1. **Duplicate product ID detection**: Cards sharing the same TCGPlayer product ID are grouped as DUPs. When all but one are fixed, the group is marked RESOLVED.
2. **CONFLICT badge**: Fixed cards that share a product ID with other fixed cards get a red CONFLICT badge, indicating an accidental double-assignment.
3. **Product ID conflict confirm**: When assigning a product, if that product ID is already used by another card, a confirmation dialog shows which cards share it.
4. **Set mismatch detection**: Search results from a different TCGPlayer set than the card's set are highlighted with an orange "WRONG SET" badge and border.
5. **Set mismatch confirm**: Assigning a product from the wrong set triggers a confirmation dialog.

These checks use:
- `productIdToCards` — reverse lookup of product ID → card IDs (from the dup detection memo)
- `SET_NAME_MAP` — maps our set IDs to TCGPlayer set names (e.g., `op-01` → `['romance-dawn', ...]`)
- `isSetMismatch()` — checks if a product's `setName` is in the expected set names

## Key Files

```
src/
├── lib/
│   ├── cards.ts            # Queries cards + card_sets + prices (async, React-cached)
│   ├── supabase.ts         # Supabase client
│   ├── set-names.ts        # SET_NAME_MAP (shared between scrapers + search APIs)
│   └── products.ts         # TCGPlayer sealed product data
├── app/
│   ├── api/
│   │   ├── cards/          # Card data API (reads from cards.ts)
│   │   ├── prices/         # Price data API (reads from Supabase)
│   │   ├── mappings/       # Manual mapping submissions (/admin/mappings page)
│   │   ├── tcgplayer-search/   # TCGPlayer product search (returns setName)
│   │   └── google-tcg-search/  # Alternative TCGPlayer search (returns setName)
│   ├── admin/mappings/     # Manual card→product mapping fix page (writes source='manual')
│   ├── products/           # Sealed products browser
│   └── search/             # Card search page
scripts/
├── scrape-bandai-cards.ts  # Card catalog scraper (Bandai → cards + card_sets tables, UPSERT)
├── backup-images.ts        # Mirror card images to Cloudflare R2 (--update-db rewrites cards.image_url)
├── scrape-set-images.ts    # Booster-box tile images (TCGPlayer → data/set-images.json)
├── discover-tcg-sets.ts    # Discover TCGPlayer sets/products → tcgplayer_products/sets + set_mappings
├── auto-map-tcgplayer.ts   # Match cards → TCGPlayer products → card_tcgplayer_mapping (auto/review)
├── scrape-prices.ts        # Price scraper (TCGPlayer → tcgplayer_card_price_history + card_sales)
├── scrape-products.ts      # Sealed product scraper (TCGPlayer → products.json)
└── psa-pop-fetch.ts        # PSA population scraper (Bandai PSA pop pages → pops_psa)
```

For the end-to-end "add a new set" sequence (which scripts, in what order, and the
Bandai-now / TCGPlayer-later timing), see **[docs/adding-a-set.md](adding-a-set.md)**.
