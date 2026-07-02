-- S05 QA P0: game_goalie_changes had insert+read policies only, so the new
-- ScorerView goalie-change undo silently deleted 0 rows (and queued offline
-- deletes dead-lettered in sync-scorekeeper-queue, whose allowlist gains
-- "delete" for this table in the same change — fn v3). Mirrors the existing
-- goals/penalties delete policy convention.
-- Applied to prod 2026-07-01 via MCP apply_migration.
CREATE POLICY goalie_changes_scorer_delete ON public.game_goalie_changes
  FOR DELETE USING ((SELECT public.current_profile_id()) IS NOT NULL);
