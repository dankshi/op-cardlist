-- Scraper HQ: run-history + locked-down settings (auth cookie).
-- Powers the /admin/scraper-hq master view: what ran, what succeeded/failed,
-- token health, and self-service token refresh. Idempotent so it re-applies
-- cleanly even if an earlier partial push already created the tables.

-- Per-run audit trail. The scraper writes a 'running' row at start and patches
-- it at finish with status + stats. Writes happen via the service role (CI),
-- which bypasses RLS; admins get read-only access.
create table if not exists scraper_runs (
  id            bigint generated always as identity primary key,
  job_type      text not null,                 -- 'prices' | 'sales' | 'both' | 'card' | 'bandai' | 'products' | 'auto-map'
  trigger       text not null default 'cron',  -- 'cron' | 'manual' | 'local'
  triggered_by  uuid references profiles(id),
  scope         jsonb,                         -- { card_id, set_id, rotation_limit, ... }
  status        text not null default 'running',-- 'running' | 'success' | 'partial' | 'failed'
  error         text,
  error_code    text,                          -- e.g. 'auth_expired'
  stats         jsonb,                         -- counts + rate-limit/auth health
  log_url       text,                          -- GitHub Actions run URL when in CI
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create index if not exists scraper_runs_job_started_idx on scraper_runs (job_type, started_at desc);
create index if not exists scraper_runs_started_idx on scraper_runs (started_at desc);

alter table scraper_runs enable row level security;

drop policy if exists "scraper_runs admin read" on scraper_runs;
create policy "scraper_runs admin read"
  on scraper_runs for select
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

-- Key/value settings the scraper reads at runtime — currently the TCGplayer
-- auth cookie. Locked down: no anon access at all (the cookie is a secret); the
-- service role (CI) bypasses RLS to read it, and admins manage it via the HQ.
create table if not exists scraper_settings (
  key         text primary key,
  value       text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references profiles(id)
);

alter table scraper_settings enable row level security;

drop policy if exists "scraper_settings admin all" on scraper_settings;
create policy "scraper_settings admin all"
  on scraper_settings for all
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));
