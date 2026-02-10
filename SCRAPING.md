# Daily Scraping Runbook

Run these 2 scripts **in order** from the project root.

## Step 1: Scrape Card Data from Bandai

```bash
npx tsx scripts/scrape.ts
```

- Fetches all card data (names, images, effects, etc.) from the official One Piece Card Game site
- Writes to `data/cards.json`
- ~3,200 cards across 20 sets
- **Must run first** because the price scraper reads cards.json to know what to look up

## Step 2: Scrape Prices from TCGPlayer → Supabase

```bash
# All sets (takes several minutes)
npx tsx scripts/scrape-prices.ts

# Single set (faster, for targeted updates)
npx tsx scripts/scrape-prices.ts --set=op14-eb04

# Debug mode (shows matching details)
npx tsx scripts/scrape-prices.ts --set=op14-eb04 --debug
```

- Matches our cards to TCGPlayer products by card number + art style
- Fetches: market price, lowest listing, median price, total listings, last sold price + date
- **Writes directly to Supabase `card_prices` table** (single source of truth)
- **Respects manual mappings**: cards marked `manually_mapped = true` keep their product IDs — only prices are refreshed
- **Must run after Step 1** so it has the latest card list

## Quick Reference

```bash
# Full daily refresh (2 steps)
npx tsx scripts/scrape.ts && npx tsx scripts/scrape-prices.ts
```

## How Manual Fixes Work

1. On the `/test` page, a user fixes a wrong card→product mapping
2. The fix is saved to both `card_mappings` (audit trail) and `card_prices` (source of truth)
3. The fix is immediately visible on the main site (reads from Supabase)
4. When the scraper runs, it sees `manually_mapped = true` and preserves the product ID
5. The scraper still fetches fresh prices for that product from TCGPlayer

## Notes

- Valid set IDs: `op-01` through `op-13`, `eb-01` through `eb-03`, `op14-eb04`, `prb-01`
- Last sold prices are fetched from `mpapi.tcgplayer.com/v2/product/{id}/latestsales` (5 concurrent, 100ms delay between batches)
- The app reads prices directly from Supabase at request time (cached per request via React `cache()`)
- Supabase secrets must be set in GitHub repo settings for the CI workflow to work
