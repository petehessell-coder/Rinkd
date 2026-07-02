-- S07 D-S07-1: team spectator follow — the follow-graph hole (leagues +
-- tournaments had follow; the team, the most-shared object, didn't; a fan's
-- only option was requesting to JOIN the roster). Mirrors league_subscriptions
-- exactly: own-rows-only RLS, composite PK, cascade on team delete.
-- Applied to prod 2026-07-02 via MCP apply_migration.
CREATE TABLE public.team_subscriptions (
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  team_id    uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, team_id)
);

ALTER TABLE public.team_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY team_subscriptions_select_own ON public.team_subscriptions
  FOR SELECT USING ((SELECT public.current_profile_id()) = user_id);
CREATE POLICY team_subscriptions_insert_self ON public.team_subscriptions
  FOR INSERT WITH CHECK ((SELECT public.current_profile_id()) = user_id);
CREATE POLICY team_subscriptions_delete_self ON public.team_subscriptions
  FOR DELETE USING ((SELECT public.current_profile_id()) = user_id);

CREATE INDEX team_subscriptions_team_idx ON public.team_subscriptions (team_id);
