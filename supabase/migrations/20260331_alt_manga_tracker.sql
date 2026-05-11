-- Alt.xyz manga card population & price tracker
create table if not exists alt_manga_tracker (
  id uuid primary key default gen_random_uuid(),
  alt_listing_id text not null,
  alt_asset_id text,
  set_code text not null,
  card_name text not null,
  alt_url text not null,

  -- Card details from alt.xyz
  full_name text,
  subject text,
  brand text,
  variety text,
  card_number text,
  image_url text,

  -- Pricing
  lowest_price numeric,

  -- Population data (PSA)
  psa_10 integer default 0,
  psa_9 integer default 0,
  psa_8 integer default 0,
  psa_7 integer default 0,
  psa_other integer default 0,
  psa_total integer default 0,

  -- Population data (BGS)
  bgs_10 integer default 0,
  bgs_95 integer default 0,
  bgs_9 integer default 0,
  bgs_other integer default 0,
  bgs_total integer default 0,

  -- Population data (CGC)
  cgc_10 integer default 0,
  cgc_95 integer default 0,
  cgc_other integer default 0,
  cgc_total integer default 0,

  last_scraped_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- History table for tracking changes over time
create table if not exists alt_manga_tracker_history (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid references alt_manga_tracker(id) on delete cascade,
  lowest_price numeric,
  psa_10 integer,
  psa_9 integer,
  psa_total integer,
  bgs_95 integer,
  bgs_total integer,
  cgc_10 integer,
  cgc_total integer,
  recorded_at timestamptz default now()
);

create unique index if not exists alt_manga_tracker_listing_idx on alt_manga_tracker(alt_listing_id);
create index if not exists alt_manga_tracker_set_idx on alt_manga_tracker(set_code);
create index if not exists alt_manga_history_tracker_idx on alt_manga_tracker_history(tracker_id);
create index if not exists alt_manga_history_date_idx on alt_manga_tracker_history(recorded_at);
