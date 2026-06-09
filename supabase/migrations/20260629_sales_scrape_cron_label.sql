-- Reschedule the pg_cron sales dispatch to tag its runs distinctly.
--
-- Previously pg_cron and the HQ "Run now" button both dispatched via
-- workflow_dispatch, so both recorded as trigger='manual' in scraper_runs and
-- were indistinguishable. update-sales.yml now accepts a `trigger_source`
-- input that the scraper records verbatim, so pass 'cron' here. The HQ button
-- passes 'manual'; GitHub's own (throttled) schedule records as 'github-cron'.
--
-- Idempotent: unschedule the existing job, then recreate with the new body.

select cron.unschedule('dispatch-sales-scrape')
where exists (select 1 from cron.job where jobname = 'dispatch-sales-scrape');

select cron.schedule(
  'dispatch-sales-scrape',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url     := 'https://api.github.com/repos/dankshi/op-cardlist/actions/workflows/update-sales.yml/dispatches',
    body    := jsonb_build_object('ref', 'nomi', 'inputs', jsonb_build_object('trigger_source', 'cron')),
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
