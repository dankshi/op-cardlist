-- Reliable 5-minute trigger for the OPCG Discord price monitor, from pg_cron.
--
-- WHY: dankshi/opcg-discord-monitors runs a TCGplayer price monitor
-- (monitor-tcgplayer.yml) on a `*/5 * * * *` GitHub schedule, but GitHub
-- throttles scheduled runs hard on shared runners (observed: 1-5h gaps instead
-- of every 5 min), so sub-target listings that appear and sell inside a gap are
-- never polled and never alerted. pg_cron fires on time and POSTs to that repo's
-- workflow_dispatch API via pg_net — the same trick we already use for the sales
-- scraper (see 20260628_sales_scrape_cron.sql).
--
-- PREREQUISITE: the fine-grained GitHub PAT in public.scraper_settings
-- ('github_token') must have `Actions: write` on dankshi/opcg-discord-monitors
-- (in addition to op-cardlist). Until then the job still fires every 5 min but
-- GitHub returns 401/404 (harmless no-op).
--
-- The GitHub Actions `*/5` schedule on monitor-tcgplayer.yml is intentionally
-- LEFT in place as a slow fallback — that workflow's concurrency group drops
-- overlapping ticks, so a stray GH-scheduled run can't pile up on a pg_cron one.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent (re)schedule: drop any prior copy before creating, so re-running
-- this migration / editing the cadence doesn't error or duplicate the job.
select cron.unschedule('dispatch-opcg-monitor')
where exists (select 1 from cron.job where jobname = 'dispatch-opcg-monitor');

select cron.schedule(
  'dispatch-opcg-monitor',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url     := 'https://api.github.com/repos/dankshi/opcg-discord-monitors/actions/workflows/monitor-tcgplayer.yml/dispatches',
    body    := jsonb_build_object('ref', 'master'),
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
