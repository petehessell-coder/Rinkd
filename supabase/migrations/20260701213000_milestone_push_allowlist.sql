-- S06 N2: push the milestone to the ACHIEVER only. _award_milestone writes two
-- notification shapes: the achiever's own row (recipient_id = actor_id) and
-- teammate fan-out rows (recipient != actor). Pushing every teammate per
-- milestone would be spam; the achiever's "Milestone unlocked" is the push a
-- parent thanks you for. In-app rows unaffected.
-- Applied to prod 2026-07-01 via MCP apply_migration.
DROP TRIGGER IF EXISTS trg_enqueue_notification_push ON public.notifications;
CREATE TRIGGER trg_enqueue_notification_push
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  WHEN (
    new.kind = ANY (ARRAY['comment','mention','reaction','message',
                          'team_join_request','team_join_approved',
                          'team_join_denied','game_puck_won'])
    OR (new.kind = 'milestone' AND new.recipient_id = new.actor_id)
  )
  EXECUTE FUNCTION enqueue_notification_push();
