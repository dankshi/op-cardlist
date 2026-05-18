# Architecture

## Data Sources

| Data | Where | Written By |
|------|-------|------------|
| Card catalog (names, rarity, images, effects) | Supabase `cards` + `card_sets` tables | `scripts/scrape-bandai-cards.ts` (from Bandai) |
| Prices + TCGPlayer mappings | Supabase `tcgplayer_card_prices` table | `scripts/scrape-prices.ts` + `/test` page |
| Manual mapping audit trail | Supabase `card_mappings` table | `/test` page |
| TCGPlayer sealed products | `data/products.json` | `scripts/scrape-products.ts` |
| PSA grading populations | Supabase `pops_psa` table | `scripts/psa-pop-fetch.ts` |

## How It Works

1. **Card catalog** is scraped from Bandai's official site per set and UPSERTed directly into Supabase `cards` + `card_sets`. The scraper is incremental — pass set series IDs to scrape only those sets without touching the rest. Reprint protection: if a card is already in the DB under a different `set_id` (e.g. a PRB-02 reprint of an EB01 card), the original set_id is preserved.
2. **Prices** live in Supabase `tcgplayer_card_prices` — the single source of truth.
3. The app reads card metadata + prices from Supabase at request time, cached per-request via React `cache()` in [src/lib/cards.ts](../src/lib/cards.ts).
4. The `/test` page lets users fix wrong card→product mappings; fixes go directly to `tcgplayer_card_prices`.
5. The scraper respects `manually_mapped = true` — it keeps the product ID but refreshes prices.

## Daily Pipeline

```bash
npx tsx scripts/scrape-bandai-cards.ts           # 1. Card catalog from Bandai → cards + card_sets tables
npx tsx scripts/scrape-prices.ts                 # 2. Prices from TCGPlayer → Supabase tcgplayer_card_prices
```

For a new set release, pass the series IDs to scrape only those:

```bash
npx tsx scripts/scrape-bandai-cards.ts 569115 569302  # scrape only OP-15 + PRB-02
npx tsx scripts/backup-images.ts --update-db          # upload new images to R2 + rewrite cards.image_url
```

## /test Page Safeguards

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
│   ├── cards.ts            # Queries cards + card_sets + card_prices tables (async, React-cached)
│   ├── supabase.ts         # Supabase client
│   ├── set-names.ts        # SET_NAME_MAP (shared between scraper + search APIs)
│   └── products.ts         # TCGPlayer sealed product data
├── app/
│   ├── api/
│   │   ├── cards/          # Card data API (reads from cards.ts)
│   │   ├── prices/         # Price data API (reads from Supabase)
│   │   ├── mappings/       # Manual mapping submissions (/test page)
│   │   ├── tcgplayer-search/   # TCGPlayer product search (returns setName)
│   │   └── google-tcg-search/  # Alternative TCGPlayer search (returns setName)
│   ├── test/               # Manual mapping fix page
│   ├── products/           # Sealed products browser
│   └── search/             # Card search page
scripts/
├── scrape-bandai-cards.ts  # Card catalog scraper (Bandai → cards + card_sets tables, UPSERT)
├── scrape-prices.ts        # Price scraper (TCGPlayer → Supabase tcgplayer_card_prices)
├── scrape-products.ts      # Sealed product scraper (TCGPlayer → products.json)
├── backup-images.ts        # Mirror card images to Cloudflare R2 (--update-db rewrites cards.image_url)
└── psa-pop-fetch.ts        # PSA population scraper (Bandai PSA pop pages → pops_psa)
```
