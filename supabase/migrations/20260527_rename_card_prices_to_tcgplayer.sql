-- Rename card_prices → tcgplayer_card_prices for naming symmetry with
-- tcgplayer_card_price_history (migration 20260525) and to make the
-- price source explicit. card_prices was ambiguous — when we add our
-- own marketplace prices later they'd go in something like
-- nomi_card_prices, and "card_prices" with no qualifier becomes
-- confusing.
--
-- The table still stores:
--   - The current TCGplayer price snapshot (overwritten each scrape)
--   - Deprecated mapping cols (tcgplayer_product_id, _url, _name,
--     manually_mapped, mapped_by) — superseded by card_tcgplayer_mapping
--     but still in place for backward compat (will be dropped in a
--     follow-up once scrape-prices.ts stops writing them).
--
-- Indexes auto-rename with the table. RLS policies stay attached. The
-- price_history table already has the new name from migration 20260525.

ALTER TABLE card_prices RENAME TO tcgplayer_card_prices;

-- Keep the auto-bump-on-update trigger working under the new name.
DROP TRIGGER IF EXISTS update_card_prices_updated_at ON tcgplayer_card_prices;
CREATE TRIGGER update_tcgplayer_card_prices_updated_at
  BEFORE UPDATE ON tcgplayer_card_prices
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
