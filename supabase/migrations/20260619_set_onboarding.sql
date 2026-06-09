-- New-set onboarding with a staging/verification gate.
-- Admins describe a new set + the links to scrape; a staging scrape lands the
-- cards in staged_cards (never the live catalog); after review, promote copies
-- them live and registers the TCGplayer slugs so prices/sales pick the set up.

create table if not exists set_onboarding (
  id                 bigint generated always as identity primary key,
  set_id             text not null,                 -- bandai set id, e.g. 'op-17'
  name               text not null,
  bandai_series_id   text not null,                 -- Bandai cardlist ?series= id
  bandai_site        text not null default 'en',    -- 'en' | 'asia-en'
  tcgplayer_slugs    text[] not null default '{}',  -- TCGplayer set URL slug(s)
  release_date       date,
  status             text not null default 'draft', -- draft|staging|staged|promoted|failed
  staged_card_count  integer not null default 0,
  error              text,
  created_by         uuid references profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table set_onboarding enable row level security;
drop policy if exists "set_onboarding admin all" on set_onboarding;
create policy "set_onboarding admin all" on set_onboarding for all
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

-- Staging mirror of the cards table (+ onboarding_id). Filled by the staging
-- scrape; promoted into cards on approval. Mirrors cards columns the scraper
-- writes (art_style included so promote can seed it).
create table if not exists staged_cards (
  onboarding_id  bigint not null references set_onboarding(id) on delete cascade,
  id             text not null,
  base_id        text,
  set_id         text,
  name           text,
  type           text,
  colors         text[],
  rarity         text,
  cost           integer,
  power          integer,
  counter        integer,
  life           integer,
  attribute      text,
  traits         text[],
  effect         text,
  trigger_text   text,
  image_url      text,
  variant        text,
  art_style      text,
  staged_at      timestamptz not null default now(),
  primary key (onboarding_id, id)
);

alter table staged_cards enable row level security;
drop policy if exists "staged_cards admin read" on staged_cards;
create policy "staged_cards admin read" on staged_cards for select
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

-- DB-registered TCGplayer slug(s) per set. The price scraper / auto-mapper
-- consult this in ADDITION to the in-code SET_NAME_MAP, so a freshly promoted
-- set is discoverable without a code change.
create table if not exists set_tcgplayer_slugs (
  set_id  text primary key,
  slugs   text[] not null default '{}'
);

alter table set_tcgplayer_slugs enable row level security;
drop policy if exists "set_tcgplayer_slugs admin all" on set_tcgplayer_slugs;
create policy "set_tcgplayer_slugs admin all" on set_tcgplayer_slugs for all
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));
-- Public read so the price scraper (anon key) and site can resolve slugs.
drop policy if exists "set_tcgplayer_slugs public read" on set_tcgplayer_slugs;
create policy "set_tcgplayer_slugs public read" on set_tcgplayer_slugs for select using (true);
