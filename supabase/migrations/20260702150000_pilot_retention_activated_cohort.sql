-- Pete's denominator sign-off (2026-07-02): retention is measured against the
-- ACTIVATED cohort (signed up AND connected), not all signups — people who
-- never connected aren't "lost". Window stays week-2. Same activated-action
-- set the activation view uses. security_invoker preserved.
-- Applied to prod 2026-07-02 via MCP apply_migration.
CREATE OR REPLACE VIEW public.analytics_pilot_retention
WITH (security_invoker = on) AS
WITH cohort AS (
  SELECT s.ref, s.user_id, s.joined_at
  FROM (
    SELECT properties->>'ref' AS ref, user_id, min(created_at) AS joined_at
    FROM public.analytics_events
    WHERE event = 'signup_success' AND user_id IS NOT NULL
      AND properties->>'ref' IS NOT NULL
    GROUP BY properties->>'ref', user_id
  ) s
  WHERE EXISTS (
    SELECT 1 FROM public.analytics_events a
    WHERE a.user_id = s.user_id
      AND a.event IN ('league_subscribed','team_followed','onboarding_follow','discover_follow','follow')
  )
),
activity AS (
  SELECT DISTINCT user_id, date_trunc('week', created_at) AS wk
  FROM public.analytics_events
  WHERE user_id IS NOT NULL
)
SELECT
  c.ref,
  count(DISTINCT c.user_id)                                              AS cohort_size,
  count(DISTINCT a.user_id) FILTER (
    WHERE a.wk = date_trunc('week', c.joined_at) + interval '1 week')     AS returned_week2,
  round(100.0 * count(DISTINCT a.user_id) FILTER (
    WHERE a.wk = date_trunc('week', c.joined_at) + interval '1 week')
    / NULLIF(count(DISTINCT c.user_id), 0), 1)                            AS retention_week2_pct
FROM cohort c
LEFT JOIN activity a ON a.user_id = c.user_id
GROUP BY c.ref;
