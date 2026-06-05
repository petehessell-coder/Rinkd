-- Pre-pilot audit #2 (Jun 5 2026) — close the unauthenticated PII harvest.
-- The audit reproduced (with the public anon key, zero auth):
--   GET /rest/v1/profiles?select=email,date_of_birth   -> every user's PII
--   GET /rest/v1/survey_responses?select=email,name     -> every lead's email
--   GET /rest/v1/team_members?select=invite_email        -> invitees' emails
-- Applied to prod via MCP apply_migration on 2026-06-05; verified afterward
-- that anon gets 401 on the sensitive columns and 200 on display columns.
--
-- Mechanism note: anon held a TABLE-level SELECT grant (expands to all
-- columns), so a column-level REVOKE is a no-op. The fix drops the table grant
-- and re-grants only the non-sensitive display columns. `authenticated` is left
-- untouched (the /profile + /settings ProtectedRoute pages still select('*')).
--
-- Residual (tracked, post-pilot): an *authenticated* user can still read peers'
-- email/DOB because ~6 in-app features (scoresheet email, scorer pickers,
-- onboarding seed-follow, Settings) read those columns while logged in. Closing
-- that requires routing those reads through SECURITY DEFINER RPCs / the service
-- role and is a separate change.

-- profiles: replace anon table-wide SELECT with a display-only allowlist
REVOKE SELECT ON public.profiles FROM anon;
GRANT SELECT (
  id, name, handle, avatar_color, avatar_initials, bio, "position", level,
  home_rink, points, tier, created_at, updated_at, is_premium, premium_until,
  cover_image_url, onboarding_completed_at, welcome_seen, avatar_url, is_admin,
  persona, gender, last_seen_at, notification_email_transactional,
  notification_email_marketing, notification_push, profile_complete
) ON public.profiles TO anon;

-- team_members: same, excluding invite_email
REVOKE SELECT ON public.team_members FROM anon;
GRANT SELECT (
  id, team_id, user_id, role, jersey_number, "position", shot_hand,
  is_captain, is_alternate, status, joined_at, invite_name
) ON public.team_members TO anon;

-- survey_responses: was world-readable (SELECT USING true); nothing in the
-- client reads it. Lock reads to rinkd admins; INSERT stays open for the form.
DROP POLICY IF EXISTS "Anyone can select" ON public.survey_responses;
CREATE POLICY survey_read_admin ON public.survey_responses
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p
                 WHERE p.id = (select auth.uid()) AND p.is_admin = true));
