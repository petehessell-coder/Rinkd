-- Roster join-requests now fire a web push (not just an in-app row).
--
-- notify_team_manager_on_join_request already inserts a notification for every
-- team manager AND every league commissioner of the team (minus the requester).
-- But the push trigger trg_enqueue_notification_push only fired for
-- comment/mention/reaction/message — so a commissioner got an in-app notification
-- with no push. This bit when the only team manager IS the requester (e.g. a
-- league director requesting to join the team they manage): self-excluded, the
-- league commissioner was the sole recipient and got no real-time alert.
--
-- Add 'team_join_request' to the push WHEN clause. enqueue_notification_push is
-- kind-agnostic (it just posts the notification id to send-notification-push).

DROP TRIGGER IF EXISTS trg_enqueue_notification_push ON public.notifications;
CREATE TRIGGER trg_enqueue_notification_push
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  WHEN (new.kind = ANY (ARRAY['comment'::text, 'mention'::text, 'reaction'::text, 'message'::text, 'team_join_request'::text]))
  EXECUTE FUNCTION enqueue_notification_push();
