-- Rename card_mappings → card_mappings_legacy.
--
-- Background:
--   card_mappings was the original /test page audit trail (with approved
--   flag, submitted_by, art_style). It was never fully integrated as the
--   active mapping table — only 385 rows ever made it in, and the app
--   read mappings from card_prices, not here.
--
--   card_tcgplayer_mapping (created in migration 20260524) is now the
--   single source of truth for card_id ↔ tcgplayer_product_id. Both the
--   /test page POST and the auto-mapper write here; lib/cards.ts reads
--   from here via JOIN.
--
--   Renaming (not dropping) preserves the historical /test submissions in
--   case anyone wants to audit who-mapped-what before this refactor.
--   Drop the _legacy table when no longer useful.
--
-- Note: card_prices still has mapping columns (tcgplayer_product_id,
-- tcgplayer_url, tcgplayer_product_name, manually_mapped, mapped_by).
-- They're deprecated and superseded by card_tcgplayer_mapping but stay
-- in place until scrape-prices.ts is fully migrated to write mappings
-- only to card_tcgplayer_mapping. Tracked as follow-up.

ALTER TABLE card_mappings RENAME TO card_mappings_legacy;

-- Drop the old trigger and re-create it with the new table name so
-- updated_at keeps working on the renamed table.
DROP TRIGGER IF EXISTS update_card_mappings_updated_at ON card_mappings_legacy;
CREATE TRIGGER update_card_mappings_legacy_updated_at
  BEFORE UPDATE ON card_mappings_legacy
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
