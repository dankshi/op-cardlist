-- Source-health rollup for the /admin/price-sources dashboard: one row per
-- ingestion source with counts + recency, so the page is a single query
-- instead of per-source aggregation. See docs/slab-pricing.md.
--
-- Read only by the admin page via the service-role client. Not granted to
-- anon/authenticated — it aggregates across all statuses (incl. excluded),
-- which the public RLS policy on slab_sales deliberately hides.

CREATE OR REPLACE VIEW slab_source_health AS
SELECT
  source,
  COUNT(*)                                        AS total,
  COUNT(*) FILTER (WHERE status = 'visible')      AS visible,
  COUNT(*) FILTER (WHERE status = 'excluded')     AS excluded,
  COUNT(*) FILTER (WHERE status = 'hidden')       AS hidden,
  MAX(created_at)                                 AS last_ingested,
  MAX(sold_at)                                    AS latest_sale
FROM slab_sales
GROUP BY source;

GRANT SELECT ON slab_source_health TO service_role;

COMMENT ON VIEW slab_source_health IS
  'Per-source counts + recency over slab_sales. Admin-only (service-role read); not for anon/authenticated.';
