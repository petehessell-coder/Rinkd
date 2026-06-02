-- ============================================================================
-- Rinkd — pilot analytics queries
-- ============================================================================
-- Copy-paste into the Supabase SQL editor (Dashboard → SQL Editor) during the
-- BLPA Cleveland pilot (Jun 13–14, 2026) to see what users are doing.
--
-- Data model (see CLAUDE_CODE_HANDOFF.md §7 ANALYTICS-PAGEVIEW-1):
--   public.analytics_events  — one row per event. Columns: event, user_id,
--     session_id, url (pathname; query string stripped on page_view), referrer,
--     user_agent, properties (jsonb), created_at.
--   A `page_view` fires on EVERY route change (src/components/RouteAnalytics.js).
--   Per-session navigation paths reconstruct by ORDER BY created_at within a
--   session_id. Raw events are pruned after 90 days; daily aggregates persist
--   in public.analytics_daily_rollup. Reads are commissioner/admin-only (RLS).
--
-- Helper views: analytics_top_pages, analytics_entry_pages (both last 30d).
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────
-- 1. SESSION NAVIGATION PATHS — the clean clickstream (page_view only)
--    Each row = one session's pages in the order they were visited.
--    Use this DURING/AFTER the pilot once page_view rows have accrued.
-- ─────────────────────────────────────────────────────────────────────────
SELECT
  right(session_id, 8)                        AS session,
  to_char(min(created_at), 'Mon DD HH24:MI')  AS started,
  count(*)                                     AS pages,
  count(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS signed_in,
  string_agg(url, '  →  ' ORDER BY created_at) AS path
FROM public.analytics_events
WHERE event = 'page_view'
  AND created_at > now() - interval '24 hours'   -- widen to '2 days' for the full weekend
  AND session_id IS NOT NULL
GROUP BY session_id
HAVING count(*) >= 2
ORDER BY pages DESC
LIMIT 30;


-- ─────────────────────────────────────────────────────────────────────────
-- 2. SESSION PATHS — all events (works even before page_view data builds up)
--    Noisier than #1 (some pages fire multiple instrumented events) but useful
--    immediately. Swap the filter back to page_view (#1) once traffic lands.
-- ─────────────────────────────────────────────────────────────────────────
SELECT
  right(session_id, 8)                        AS session,
  to_char(min(created_at), 'Mon DD HH24:MI')  AS started,
  count(*)                                     AS events,
  count(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS signed_in,
  left(string_agg(coalesce(url, '(none)'), '  →  ' ORDER BY created_at), 400) AS path
FROM public.analytics_events
WHERE created_at > now() - interval '7 days'
  AND session_id IS NOT NULL
GROUP BY session_id
HAVING count(*) >= 4
ORDER BY events DESC
LIMIT 20;


-- ─────────────────────────────────────────────────────────────────────────
-- 3. TOP PAGES — most-viewed paths (last 30d). Same data as the
--    /admin/analytics "Top pages" panel; reads the analytics_top_pages view.
-- ─────────────────────────────────────────────────────────────────────────
SELECT page, views, sessions, users
FROM public.analytics_top_pages
LIMIT 40;


-- ─────────────────────────────────────────────────────────────────────────
-- 4. ENTRY PAGES — where sessions begin (the first page_view per session).
-- ─────────────────────────────────────────────────────────────────────────
SELECT page, sessions
FROM public.analytics_entry_pages
LIMIT 40;


-- ─────────────────────────────────────────────────────────────────────────
-- 5. TRAFFIC SOURCES — external referrer + campaign tags (UTM / fbclid live on
--    the entry events; page_view URLs are scrubbed). Good for "where did pilot
--    traffic come from?"
-- ─────────────────────────────────────────────────────────────────────────
SELECT
  coalesce(nullif(split_part(split_part(referrer, '://', 2), '/', 1), ''), '(direct / none)') AS source_host,
  count(*) AS hits,
  count(DISTINCT session_id) AS sessions
FROM public.analytics_events
WHERE created_at > now() - interval '7 days'
GROUP BY 1
ORDER BY sessions DESC
LIMIT 25;


-- ─────────────────────────────────────────────────────────────────────────
-- 6. DAILY FUNNEL — event counts per day (last 14d). Long-term history lives
--    in analytics_daily_rollup even after raw events are pruned at 90d.
-- ─────────────────────────────────────────────────────────────────────────
SELECT day, event, events, users
FROM public.analytics_daily_rollup
WHERE day > (now() - interval '14 days')::date
ORDER BY day DESC, events DESC;


-- ─────────────────────────────────────────────────────────────────────────
-- 7. RESOLVE A PAGE PATH TO A NAME — paths carry UUIDs; map them to names.
--    Paste the id from a /league/<id> or /tournament/<id> path.
-- ─────────────────────────────────────────────────────────────────────────
-- SELECT name FROM public.leagues     WHERE id = '<uuid>';
-- SELECT name FROM public.tournaments WHERE id = '<uuid>';
-- SELECT name FROM public.teams       WHERE id = '<uuid>';
