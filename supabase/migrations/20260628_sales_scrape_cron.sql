-- Reliable 5-minute sales-scrape trigger, driven from Supabase pg_cron.
--
-- WHY: GitHub Actions' native `*/5 * * * *` schedule gets throttled hard on
-- shared runners (observed: every 2-3h instead of every 5 min), so the sales
-- rotation never cycles the catalog. pg_cron fires on time and POSTs to the
-- GitHub workflow_dispatch API via pg_net, mirroring exactly what the HQ
-- "Run sales now" button does (src/app/api/admin/scraper-hq/run/route.ts).
--
-- PREREQUISITE: a fine-grained GitHub PAT with `Actions: write` on
-- dankshi/op-cardlist must be stored in public.scraper_settings under the key
-- 'github_token' (add it via Admin -> Scraper HQ -> "Save token"). Until then
-- the job still fires every 5 min but GitHub returns 401 (harmless no-op).
--
-- The GitHub Actions `*/5` schedule on update-sales.yml is intentionally LEFT
-- in place as a slow fallback — the workflow's concurrency group already drops
-- overlapping ticks, so a stray GH-scheduled run can't pile up on a pg_cron one.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent (re)schedule: drop any prior copy before creating, so re-running
-- this migration / editing the cadence doesn't error or duplicate the job.
select cron.unschedule('dispatch-sales-scrape')
where exists (select 1 from cron.job where jobname = 'dispatch-sales-scrape');

select cron.schedule(
  'dispatch-sales-scrape',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url     := 'https://api.github.com/repos/dankshi/op-cardlist/actions/workflows/update-sales.yml/dispatches',
    body    := jsonb_build_object('ref', 'nomi'),
    headers := jsonb_build_object(
      'Authorization',         'Bearer ' || coalesce((select value from public.scraper_settings where key = 'github_token'), ''),
      'Accept',                'application/vnd.github+json',
      'X-GitHub-Api-Version',  '2022-11-28',
      'Content-Type',          'application/json',
      'User-Agent',            'op-cardlist-pg-cron'
    )
  );
  $job$
);
