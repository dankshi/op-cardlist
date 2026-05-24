-- Lightweight damage capture for items received during intake.
--
-- Per the simplified Receiving Flow (see docs/admin-intake-flow.md):
-- we capture damage as a free-text note rather than a structured
-- damage_attribution enum (courier / seller_packaging / internal_handling
-- from the StockX-style reference spec). Operators flag the damage at
-- receive time so the authenticator downstream knows the item was sent
-- as LP/HP, not NM. Structured analytics can be backfilled from notes
-- later if/when volume justifies the enum.

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS is_damaged BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS damage_notes TEXT;
