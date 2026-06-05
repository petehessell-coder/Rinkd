-- Pre-pilot audit #2 (Jun 5 2026) — performance hygiene on post-May feature
-- tables. All additive / semantics-preserving. Applied to prod via MCP
-- apply_migration on 2026-06-05.

-- 1) Missing FK covering indexes (slow joins / cascade deletes without these)
CREATE INDEX IF NOT EXISTS idx_messages_sender_id            ON public.messages          (sender_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_msg_sender ON public.conversations     (last_message_sender_id);
CREATE INDEX IF NOT EXISTS idx_gpv_voted_league_team         ON public.game_puck_votes   (voted_league_team_id);
CREATE INDEX IF NOT EXISTS idx_gpv_voted_tournament_team     ON public.game_puck_votes   (voted_tournament_team_id);
CREATE INDEX IF NOT EXISTS idx_suspensions_source_game       ON public.game_suspensions  (source_game_id);
CREATE INDEX IF NOT EXISTS idx_suspensions_served_game       ON public.game_suspensions  (served_game_id);
CREATE INDEX IF NOT EXISTS idx_league_games_shootout_winner  ON public.league_games      (shootout_winner);
CREATE INDEX IF NOT EXISTS idx_order_items_variant_id        ON public.order_items       (variant_id);
CREATE INDEX IF NOT EXISTS idx_suspensions_division_id       ON public.game_suspensions  (division_id);
CREATE INDEX IF NOT EXISTS idx_gamesheet_links_division_id   ON public.gamesheet_links   (division_id);

-- 2) Drop duplicate index (identical to idx_analytics_events_event_created_at)
DROP INDEX IF EXISTS public.analytics_events_event_idx;

-- 3) Auth RLS InitPlan — wrap bare auth.uid() in (select auth.uid()) so it is
--    evaluated once per query instead of once per row. Every other predicate
--    is preserved exactly.
ALTER POLICY comment_mentions_insert ON public.comment_mentions
  WITH CHECK (EXISTS (SELECT 1 FROM comments c
                      WHERE c.id = comment_mentions.comment_id
                        AND c.author_id = (select auth.uid())));

ALTER POLICY cp_update_self ON public.conversation_participants
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

ALTER POLICY msg_insert ON public.messages
  WITH CHECK ((sender_id = (select auth.uid())) AND is_conversation_participant(conversation_id));

ALTER POLICY order_items_select_own ON public.order_items
  USING (EXISTS (SELECT 1 FROM orders o
                 WHERE o.id = order_items.order_id
                   AND o.buyer_profile_id = (select auth.uid())));

ALTER POLICY orders_select_own ON public.orders
  USING (buyer_profile_id = (select auth.uid()));

ALTER POLICY post_mentions_insert ON public.post_mentions
  WITH CHECK (EXISTS (SELECT 1 FROM posts p
                      WHERE p.id = post_mentions.post_id
                        AND p.author_id = (select auth.uid())));
