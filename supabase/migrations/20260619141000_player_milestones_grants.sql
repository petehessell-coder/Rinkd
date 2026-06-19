-- ENGAGE-1 hardening — lock down the SECURITY DEFINER write helpers.
--
-- Postgres grants EXECUTE to PUBLIC by default. The internal _award_* helpers
-- take arbitrary (user, kind, value, label), so a direct client call could
-- fabricate milestones + notifications for any user — defeating the whole
-- "writes only through the detector" design. Revoke PUBLIC so only the owner
-- (i.e. the definer entry point award_milestones_for_game, running as owner)
-- can reach them. The entry point stays callable by authenticated (ScorerView
-- finalize triggers detection) — safe, since it only awards REAL earned,
-- idempotent milestones computed from final-game stats; it can't fabricate.
-- NB: Supabase grants EXECUTE to anon/authenticated EXPLICITLY (default
-- privileges), so revoking PUBLIC alone leaves them — revoke by role name.
revoke all on function public._award_milestone(uuid, text, integer, text, uuid, text) from public, anon, authenticated;
revoke all on function public._award_streak(uuid, integer, uuid, text) from public, anon, authenticated;
revoke all on function public.award_milestones_for_game(uuid, text) from public, anon;
grant execute on function public.award_milestones_for_game(uuid, text) to authenticated;
