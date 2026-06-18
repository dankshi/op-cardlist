-- Annual "rotate the GitHub PAT" reminder, posted to Discord via pg_cron + pg_net.
--
-- WHY: the fine-grained PAT in scraper_settings.github_token (used by BOTH
-- dispatch-sales-scrape and dispatch-opcg-monitor) expires yearly. If it lapses,
-- every workflow_dispatch silently 401s and Discord alerts stop. A claude.ai
-- cloud routine was tried first but depended on the cloud GitHub integration
-- staying authorized — exactly the kind of silent-expiry failure this reminder
-- exists to prevent — so it lives here instead: same Postgres, same pg_net path
-- as the dispatchers it protects, no external dependency.
--
-- Fires 16:00 UTC (09:00 America/Los_Angeles) every May 26, ~2 weeks before the
-- typical early-June expiry. Rotating the PAT resets its expiry ~1 year out, so
-- an annual cadence stays roughly aligned. Message is year-agnostic on purpose.
--
-- PREREQUISITE: store the target Discord webhook (the OPCG shared channel) in
-- scraper_settings under key 'opcg_discord_webhook' — kept out of git on purpose:
--   insert into public.scraper_settings (key, value) values ('opcg_discord_webhook', '<webhook-url>')
--   on conflict (key) do update set value = excluded.value;
-- Until set, the job fires but posts to '' (harmless no-op, logged in cron run details).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('opcg-token-rotation-reminder')
where exists (select 1 from cron.job where jobname = 'opcg-token-rotation-reminder');

select cron.schedule(
  'opcg-token-rotation-reminder',
  '0 16 26 5 *',
  $job$
  select net.http_post(
    url     := coalesce((select value from public.scraper_settings where key = 'opcg_discord_webhook'), ''),
    body    := jsonb_build_object(
      'content',
      '@everyone 🔑 Annual reminder: rotate the GitHub fine-grained PAT "op-cardlist scraper dispatch" — it expires around now (early June). Regenerate it keeping Actions: Read and write on BOTH dankshi/op-cardlist and dankshi/opcg-discord-monitors, then re-save via Admin → Scraper HQ → "Save token" so scraper_settings.github_token updates. If it lapses, dispatch-sales-scrape and dispatch-opcg-monitor both 401 and Discord alerts silently stop.',
      'allowed_mentions', jsonb_build_object('parse', jsonb_build_array('everyone'))
    ),
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
  $job$
);
