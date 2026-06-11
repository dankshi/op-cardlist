# Listing Watch — live buy-alerts for rare TCGplayer products

This document covers the **active-listing watcher**: a poller that Discord-pings
the moment a *live listing* appears for a watched product, so you can be first to
buy a rare card.

It is the live-inventory counterpart to [PRICE-SCRAPING.md](PRICE-SCRAPING.md) /
`scrape-prices.ts`. Those answer **"what did it sell for?"** by ingesting the
TCGplayer `latestsales` (completed-sales) feed. This answers **"one's for sale
RIGHT NOW"** by polling the marketplace **listings** feed. Different endpoint,
different goal, separate state.

## Why a separate path

The price/sales pipeline keys everything on `card_tcgplayer_mapping` → the Bandai
`cards` catalog. The cards this was built for are **CS championship promos** (e.g.
the Monkey.D.Luffy CS 25/26 Top Player Pack, product `649673`) that have **no
Bandai card_id at all**, so they can't live in that pipeline. The watcher's two
tables are therefore standalone — not joined to the catalog.

## Data model (`supabase/migrations/20260702_listing_watches.sql`)

| Table | Purpose |
|-------|---------|
| `listing_watches` | Which products to poll. One row per watched `product_id`, set by a human. `active=false` pauses a watch without deleting its history. |
| `listing_watch_seen` | Every `listingId` we've already processed, so the poller alerts on each listing **exactly once**. Must be persisted — GitHub Actions runners are ephemeral, so in-memory dedup would re-ping the same listing every 5 minutes. `alerted=false` marks rows recorded silently (seed / overflow). |

Both are RLS read-only to anon/authenticated; all writes go through the poller's
service-role client (same pattern as `scraper_runs`).

## The poller (`scripts/watch-listings.ts`)

Per active watch:
1. `POST mp-search-api.tcgplayer.com/v1/product/{id}/listings` (no auth needed),
   filtered to `sellerStatus: Live`, sorted price-ascending, paginated.
2. Diff returned `listingId`s against `listing_watch_seen` for that product →
   the **new** listings.
3. Alert up to `MAX_ALERTS_PER_PRODUCT` (10) cheapest-first via Discord; seed any
   overflow silently (a safety valve against a wall of pings).
4. Insert the processed listings into `listing_watch_seen`.

### Two correctness guards worth knowing

- **A failed fetch returns `[]`, never a partial list.** A transient block (TCGplayer
  serves an HTML challenge page) must not look like "0 listings" — that's just
  "no new info this tick", not a reason to re-alert later.
- **A listing is only marked seen+alerted if the Discord post succeeded.** If the
  webhook fails, the listing is left *unseen* so the next run retries it, rather
  than silently swallowing a buy alert.

### Flags

| Command | Behavior |
|---------|----------|
| `npm run watch:listings` | Poll + alert on new listings. |
| `npm run watch:listings -- --seed` | Record current listings as seen **without** alerting — onboard a watch silently (skip the backlog of already-live listings). |
| `npm run watch:listings -- --dry-run` | Log what *would* alert; write nothing. |

## Scheduling (`.github/workflows/watch-listings.yml`)

Runs every 5 minutes via GitHub Actions (mirrors `update-sales.yml`). Needs three
secrets: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (writes need the
service role), and `DISCORD_WEBHOOK_URL` (unset → polls silently, no pings). The
`workflow_dispatch` trigger has a `seed` toggle for silent onboarding from the UI.

## Adding / removing a watch

```sql
-- add
INSERT INTO listing_watches (product_id, label, tcgplayer_url, note)
VALUES (649657, 'Monkey.D.Luffy — CS 25/26 Finalist Card Set 1',
        'https://www.tcgplayer.com/product/649657', 'rare CS promo');
-- pause (keeps dedup history)
UPDATE listing_watches SET active = false WHERE product_id = 649657;
```

After adding a watch you usually want one `-- --seed` run first, so the existing
backlog of live listings doesn't all fire at once. (The two seeded promos are
left *un-seeded* on purpose — their current listings are genuinely worth knowing
about, so the first scheduled run will alert on them.)
