-- PILOT-ANALYTICS per-pilot scorecard views. All security_invoker=on, so the
-- existing RLS on analytics_events (reads restricted to commissioners/admins)
-- gates these too — no new data exposure (same pattern as analytics_top_pages).
-- Sliced by the first-touch ref carried in properties->>'ref'. For full-platform
-- pilots, activation/retention can ALSO be derived relationally from the event
-- roster; these views are the attribution (layer-on-top) path.
-- Applied to prod 2026-07-01 (via MCP apply_migration).

-- 1) Engagement by action: per-pilot counts + distinct actors per social action.
CREATE OR REPLACE VIEW public.analytics_pilot_actions
WITH (security_invoker = on) AS
SELECT
  properties->>'ref'                              AS ref,
  event,
  count(*)                                        AS actions,
  count(DISTINCT user_id)                         AS distinct_users,
  count(DISTINCT date_trunc('day', created_at))   AS active_days,
  max(created_at)                                 AS last_at
FROM public.analytics_events
WHERE event IN ('post_created','chirp_created','gamepuck_vote','reaction_added',
                'post_liked','comment_created','team_followed','league_subscribed','share_recap')
GROUP BY properties->>'ref', event;

-- 2) Activation: signups per pilot + % who also took a follow/join action.
CREATE OR REPLACE VIEW public.analytics_pilot_activation
WITH (security_invoker = on) AS
WITH signups AS (
  SELECT properties->>'ref' AS ref, user_id, min(created_at) AS signed_up_at
  FROM public.analytics_events
  WHERE event = 'signup_success' AND user_id IS NOT NULL
  GROUP BY properties->>'ref', user_id
),
activated AS (
  SELECT DISTINCT user_id
  FROM public.analytics_events
  WHERE event IN ('league_subscribed','team_followed','onboarding_follow','discover_follow','follow')
    AND user_id IS NOT NULL
)
SELECT
  s.ref,
  count(*)                                                              AS signups,
  count(*) FILTER (WHERE a.user_id IS NOT NULL)                         AS activated_users,
  round(100.0 * count(*) FILTER (WHERE a.user_id IS NOT NULL)
        / NULLIF(count(*), 0), 1)                                       AS activation_pct
FROM signups s
LEFT JOIN activated a ON a.user_id = s.user_id
GROUP BY s.ref;

-- 3) Engagement: sessions/user, 3+ session count, and social-action rate,
--    scoped to each pilot's signup cohort.
CREATE OR REPLACE VIEW public.analytics_pilot_engagement
WITH (security_invoker = on) AS
WITH pilot_users AS (
  SELECT DISTINCT properties->>'ref' AS ref, user_id
  FROM public.analytics_events
  WHERE event = 'signup_success' AND user_id IS NOT NULL
    AND properties->>'ref' IS NOT NULL
),
per_user AS (
  SELECT pu.ref, e.user_id,
         count(DISTINCT e.session_id)                    AS sessions,
         count(DISTINCT date_trunc('day', e.created_at)) AS active_days
  FROM public.analytics_events e
  JOIN pilot_users pu ON pu.user_id = e.user_id
  GROUP BY pu.ref, e.user_id
),
actors AS (
  SELECT DISTINCT user_id
  FROM public.analytics_events
  WHERE event IN ('post_created','chirp_created','gamepuck_vote','reaction_added',
                  'post_liked','comment_created','team_followed','league_subscribed','share_recap')
    AND user_id IS NOT NULL
)
SELECT
  pu.ref,
  count(*)                                                    AS active_users,
  round(avg(pu.sessions), 2)                                  AS avg_sessions_per_user,
  count(*) FILTER (WHERE pu.sessions >= 3)                    AS users_3plus_sessions,
  round(100.0 * count(*) FILTER (WHERE a.user_id IS NOT NULL)
        / NULLIF(count(*), 0), 1)                             AS action_rate_pct
FROM per_user pu
LEFT JOIN actors a ON a.user_id = pu.user_id
GROUP BY pu.ref;

-- 4) Retention: week-2 return rate for each pilot's signup-week cohort.
CREATE OR REPLACE VIEW public.analytics_pilot_retention
WITH (security_invoker = on) AS
WITH cohort AS (
  SELECT properties->>'ref' AS ref, user_id, min(created_at) AS joined_at
  FROM public.analytics_events
  WHERE event = 'signup_success' AND user_id IS NOT NULL
    AND properties->>'ref' IS NOT NULL
  GROUP BY properties->>'ref', user_id
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
