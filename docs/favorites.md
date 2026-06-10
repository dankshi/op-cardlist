# Favorites — "up X% since you favorited" (FUTURE — not built)

> Status: **not built.** Captured for later per request (2026-06-09). This is a TODO/spec, not an implemented feature.

## The idea

Let a user **favorite** (star/heart) a card. At the moment of favoriting, snapshot **two things**: the timestamp *and the card's price right then*. Later, surface **"▲ X% since you favorited (Jun 9)"** by comparing today's market value to that snapshot — a lightweight watchlist with built-in performance tracking, Robinhood-style.

## Why snapshot the price *at favorite time* (the key insight)

You can't reliably reconstruct a card's price on an arbitrary past date after the fact: raw prices have daily history (`tcgplayer_card_price_history`), but **graded comps only started accumulating recently** (`slab_market_value_history`), and mapping/override changes muddy the past. Capturing `price_at_favorite` at the moment of the action is simple, exact, and source-independent — the same principle as `collections.acquired_price`. **Do this from day one or the "since you favorited" delta is unrecoverable for early favorites.**

## Data model (sketch)

`favorites`:
- `user_id` (FK auth.users)
- `card_id` (FK cards)
- `grading_company` / `grade` (nullable — favorite a specific slab variant, or the raw card)
- `favorited_at` timestamptz
- `price_at_favorite` numeric — the headline value at favorite time
- `price_source` text — `'tcg_raw' | 'slab_comp' | 'override'`, so the later delta compares like-for-like
- PK `(user_id, card_id, grading_company, grade)` with `NULLS NOT DISTINCT` (mirrors `collections`)
- RLS: owner-only read/write

## Which price to snapshot

- **Raw favorite:** `card.price.marketPrice` (TCGplayer raw market).
- **Graded-variant favorite:** the `slab_market_values` comp (or `slab_value_overrides`) for that `(card, company, grade)`.

Store `price_source` so "since you favorited" compares against the *same* source today (don't compare a raw snapshot to a graded comp).

## The reveal

- Card page / a `/favorites` watchlist: `currentValue (same source) vs price_at_favorite → pct delta`.
- **"▲ 23% since you favorited · Jun 9, 2026"** in green/red (Robinhood style).
- Optional: a watchlist total + per-card sparkline.

## UI

- A **star/heart toggle**, top-right of the card title (next to the "Collection" pill) and as an overlay on card tiles.
- A `/favorites` watchlist page listing favorited cards with the since-favorited delta.

## Open questions / notes

- **Baseline policy:** keep the *original* favorite-time price (never overwrite) — it's the delta baseline. If a user unfavorites then re-favorites, reset the baseline to the new moment.
- **Thin data:** if there's no price at favorite time, store null and show "—" until a comp exists.
- **Future:** could store a small price series per favorite for a sparkline, but a single snapshot is enough for v1.
- Pairs naturally with the slab-pricing comp engine ([docs/slab-pricing.md](slab-pricing.md)) — the graded "current value" for the delta is just `slab_market_values` + override.
