-- Rename card_price_history → tcgplayer_card_price_history to make the
-- source explicit. The table has always been keyed by tcgplayer_product_id
-- and only contains TCGplayer-sourced prices, but the old name suggested
-- it was the canonical "card price history" — which becomes confusing when
-- we add our own marketplace prices in the future (those would go in a
-- separate own_card_price_history or similar).
--
-- Indexes auto-rename with the table. RLS policies stay attached. Code
-- readers (scrape-prices.ts, lib/price-history.ts, backfill-price-history.ts)
-- get updated in a separate change.

ALTER TABLE card_price_history RENAME TO tcgplayer_card_price_history;
