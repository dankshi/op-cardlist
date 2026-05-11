-- Add BGS Black Label column (separate from BGS 10)
alter table alt_manga_tracker add column if not exists bgs_bl integer default 0;

-- Recent listings/transactions table
create table if not exists alt_manga_listings (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid references alt_manga_tracker(id) on delete cascade,
  listing_id text not null,
  listing_type text, -- EXTERNAL_FIXED_PRICE, AUCTION, etc.
  grading_company text,
  grade text,
  price numeric,
  auction_house text, -- eBay, Alt, etc.
  image_url text,
  external_url text,
  listed_at timestamptz,
  scraped_at timestamptz default now()
);

create unique index if not exists alt_manga_listings_lid_idx on alt_manga_listings(listing_id);
create index if not exists alt_manga_listings_tracker_idx on alt_manga_listings(tracker_id);
