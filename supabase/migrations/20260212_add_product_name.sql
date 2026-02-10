-- Add TCGPlayer product name column for search matching
ALTER TABLE card_prices ADD COLUMN IF NOT EXISTS tcgplayer_product_name TEXT;
