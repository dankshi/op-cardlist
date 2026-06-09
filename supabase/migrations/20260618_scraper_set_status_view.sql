-- Per-set scrape status for the Scraper HQ: when a set was last ingested
-- (card_sets.updated_at), how many cards it has, and how many are mapped to a
-- TCGplayer product (the "is this set wired up for pricing/sales" signal).
create or replace view scraper_set_status as
select
  cs.id                       as set_id,
  cs.name                     as name,
  cs.release_date             as release_date,
  cs.updated_at               as last_scraped_at,
  count(c.id)                 as total_cards,
  count(m.card_id)            as mapped_cards
from card_sets cs
left join cards c on c.set_id = cs.id
left join card_tcgplayer_mapping m on m.card_id = c.id
group by cs.id, cs.name, cs.release_date, cs.updated_at;
