-- ============================================================================
-- REVIEW ARTIFACT — NOT A MIGRATION. DO NOT APPLY.
--
-- This is the exact DDL the §4 policy transform in
-- supabase/migrations/20260615000100_reg1_b_rls_current_profile_id.sql
-- produces against prod as of Jun 10, 2026 (138 policies). Generated with the
-- same regexp rules the migration executes at apply time. If policies change
-- on main before apply, the migration transforms the NEW state and its §8
-- assertions verify the outcome — this file is for human review only.
--
-- Regenerate any time (read-only) with the query at the bottom of this file.
-- ============================================================================

DROP POLICY analytics_daily_rollup_read_commissioners_or_admins ON public.analytics_daily_rollup;
CREATE POLICY analytics_daily_rollup_read_commissioners_or_admins ON public.analytics_daily_rollup AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_commissioner(( SELECT public.current_profile_id() AS uid)) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT public.current_profile_id() AS uid)) AND (p.is_admin = true))))));

DROP POLICY analytics_events_insert_anyone ON public.analytics_events;
CREATE POLICY analytics_events_insert_anyone ON public.analytics_events AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((user_id IS NULL) OR (user_id = ( SELECT public.current_profile_id() AS uid))));

DROP POLICY analytics_events_read_commissioners_or_admins ON public.analytics_events;
CREATE POLICY analytics_events_read_commissioners_or_admins ON public.analytics_events AS PERMISSIVE FOR SELECT TO public
  USING ((is_commissioner(( SELECT public.current_profile_id() AS uid)) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT public.current_profile_id() AS uid)) AND (p.is_admin = true))))));

DROP POLICY bug_reports_read_admin ON public.bug_reports;
CREATE POLICY bug_reports_read_admin ON public.bug_reports AS PERMISSIVE FOR SELECT TO public
  USING (is_commissioner(( SELECT public.current_profile_id() AS uid)));

DROP POLICY bug_reports_read_own ON public.bug_reports;
CREATE POLICY bug_reports_read_own ON public.bug_reports AS PERMISSIVE FOR SELECT TO public
  USING ((( SELECT public.current_profile_id() AS uid) = user_id));

DROP POLICY bug_reports_update_admin ON public.bug_reports;
CREATE POLICY bug_reports_update_admin ON public.bug_reports AS PERMISSIVE FOR UPDATE TO public
  USING (is_commissioner(( SELECT public.current_profile_id() AS uid)))
  WITH CHECK (is_commissioner(( SELECT public.current_profile_id() AS uid)));

DROP POLICY comment_mentions_insert ON public.comment_mentions;
CREATE POLICY comment_mentions_insert ON public.comment_mentions AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM comments c
  WHERE ((c.id = comment_mentions.comment_id) AND (c.author_id = ( SELECT public.current_profile_id() AS uid))))));

DROP POLICY "Authenticated users can comment" ON public.comments;
CREATE POLICY "Authenticated users can comment" ON public.comments AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT public.current_profile_id() AS uid) = author_id));

DROP POLICY "Users can delete their own comments" ON public.comments;
CREATE POLICY "Users can delete their own comments" ON public.comments AS PERMISSIVE FOR DELETE TO public
  USING ((( SELECT public.current_profile_id() AS uid) = author_id));

DROP POLICY "Users create their own comments" ON public.comments;
CREATE POLICY "Users create their own comments" ON public.comments AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT public.current_profile_id() AS uid) = author_id));

DROP POLICY "Users delete their own comments" ON public.comments;
CREATE POLICY "Users delete their own comments" ON public.comments AS PERMISSIVE FOR DELETE TO public
  USING ((( SELECT public.current_profile_id() AS uid) = author_id));

DROP POLICY "Users update their own comments" ON public.comments;
CREATE POLICY "Users update their own comments" ON public.comments AS PERMISSIVE FOR UPDATE TO public
  USING ((( SELECT public.current_profile_id() AS uid) = author_id));

DROP POLICY comments_delete_own ON public.comments;
CREATE POLICY comments_delete_own ON public.comments AS PERMISSIVE FOR DELETE TO public
  USING ((( SELECT public.current_profile_id() AS uid) = author_id));

DROP POLICY comments_insert_own ON public.comments;
CREATE POLICY comments_insert_own ON public.comments AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT public.current_profile_id() AS uid) = author_id));

DROP POLICY comments_select_all ON public.comments;
CREATE POLICY comments_select_all ON public.comments AS PERMISSIVE FOR SELECT TO public
  USING (((is_hidden = false) OR (( SELECT public.current_profile_id() AS uid) = author_id) OR is_commissioner(( SELECT public.current_profile_id() AS uid))));

DROP POLICY comments_update_own ON public.comments;
CREATE POLICY comments_update_own ON public.comments AS PERMISSIVE FOR UPDATE TO public
  USING ((( SELECT public.current_profile_id() AS uid) = author_id))
  WITH CHECK ((( SELECT public.current_profile_id() AS uid) = author_id));

DROP POLICY content_reports_delete_admin ON public.content_reports;
CREATE POLICY content_reports_delete_admin ON public.content_reports AS PERMISSIVE FOR DELETE TO public
  USING (is_commissioner(( SELECT public.current_profile_id() AS uid)));

DROP POLICY content_reports_read_admin ON public.content_reports;
CREATE POLICY content_reports_read_admin ON public.content_reports AS PERMISSIVE FOR SELECT TO public
  USING (is_commissioner(( SELECT public.current_profile_id() AS uid)));

DROP POLICY content_reports_read_own ON public.content_reports;
CREATE POLICY content_reports_read_own ON public.content_reports AS PERMISSIVE FOR SELECT TO public
  USING ((reporter_id = ( SELECT public.current_profile_id() AS uid)));

DROP POLICY cp_update_self ON public.conversation_participants;
CREATE POLICY cp_update_self ON public.conversation_participants AS PERMISSIVE FOR UPDATE TO public
  USING ((user_id = ( SELECT public.current_profile_id() AS uid)))
  WITH CHECK ((user_id = ( SELECT public.current_profile_id() AS uid)));

DROP POLICY crease_subs_owner_read ON public.crease_subscriptions;
CREATE POLICY crease_subs_owner_read ON public.crease_subscriptions AS PERMISSIVE FOR SELECT TO public
  USING ((( SELECT public.current_profile_id() AS uid) = user_id));

DROP POLICY "Users can manage own follows" ON public.follows;
CREATE POLICY "Users can manage own follows" ON public.follows AS PERMISSIVE FOR ALL TO public
  USING ((( SELECT public.current_profile_id() AS uid) = follower_id));

DROP POLICY goalie_changes_scorer_insert ON public.game_goalie_changes;
CREATE POLICY goalie_changes_scorer_insert ON public.game_goalie_changes AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT public.current_profile_id() AS uid) IS NOT NULL));

DROP POLICY goals_scorer_delete ON public.game_goals;
CREATE POLICY goals_scorer_delete ON public.game_goals AS PERMISSIVE FOR DELETE TO public
  USING ((( SELECT public.current_profile_id() AS uid) IS NOT NULL));

DROP POLICY goals_scorer_insert ON public.game_goals;
CREATE POLICY goals_scorer_insert ON public.game_goals AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT public.current_profile_id() AS uid) IS NOT NULL));

DROP POLICY game_lineups_delete ON public.game_lineups;
CREATE POLICY game_lineups_delete ON public.game_lineups AS PERMISSIVE FOR DELETE TO public
  USING ((( SELECT public.current_profile_id() AS uid) IS NOT NULL));

DROP POLICY game_lineups_insert ON public.game_lineups;
CREATE POLICY game_lineups_insert ON public.game_lineups AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT public.current_profile_id() AS uid) IS NOT NULL));

DROP POLICY game_lineups_update ON public.game_lineups;
CREATE POLICY game_lineups_update ON public.game_lineups AS PERMISSIVE FOR UPDATE TO public
  USING ((( SELECT public.current_profile_id() AS uid) IS NOT NULL));

DROP POLICY penalties_scorer_delete ON public.game_penalties;
CREATE POLICY penalties_scorer_delete ON public.game_penalties AS PERMISSIVE FOR DELETE TO public
  USING ((( SELECT public.current_profile_id() AS uid) IS NOT NULL));

DROP POLICY penalties_scorer_insert ON public.game_penalties;
CREATE POLICY penalties_scorer_insert ON public.game_penalties AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT public.current_profile_id() AS uid) IS NOT NULL));

DROP POLICY gpv_delete_own ON public.game_puck_votes;
CREATE POLICY gpv_delete_own ON public.game_puck_votes AS PERMISSIVE FOR DELETE TO authenticated
  USING ((voter_id = ( SELECT public.current_profile_id() AS uid)));

DROP POLICY gpv_insert_own_final ON public.game_puck_votes;
CREATE POLICY gpv_insert_own_final ON public.game_puck_votes AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((voter_id = ( SELECT public.current_profile_id() AS uid)) AND (((game_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM games g
  WHERE ((g.id = game_puck_votes.game_id) AND (g.status = 'final'::text))))) OR ((league_game_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM league_games lg
  WHERE ((lg.id = game_puck_votes.league_game_id) AND (lg.status = 'final'::text))))))));

DROP POLICY gpv_update_own ON public.game_puck_votes;
CREATE POLICY gpv_update_own ON public.game_puck_votes AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((voter_id = ( SELECT public.current_profile_id() AS uid)))
  WITH CHECK ((voter_id = ( SELECT public.current_profile_id() AS uid)));

DROP POLICY game_reminders_sent_owner_read ON public.game_reminders_sent;
CREATE POLICY game_reminders_sent_owner_read ON public.game_reminders_sent AS PERMISSIVE FOR SELECT TO public
  USING ((( SELECT public.current_profile_id() AS uid) = user_id));

DROP POLICY shots_scorer_insert ON public.game_shots;
CREATE POLICY shots_scorer_insert ON public.game_shots AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT public.current_profile_id() AS uid) IS NOT NULL));

DROP POLICY shots_scorer_update ON public.game_shots;
CREATE POLICY shots_scorer_update ON public.game_shots AS PERMISSIVE FOR UPDATE TO public
  USING ((( SELECT public.current_profile_id() AS uid) IS NOT NULL));

DROP POLICY game_suspensions_director_all ON public.game_suspensions;
CREATE POLICY game_suspensions_director_all ON public.game_suspensions AS PERMISSIVE FOR ALL TO public
  USING (is_tournament_director(tournament_id, ( SELECT public.current_profile_id() AS uid)))
  WITH CHECK (is_tournament_director(tournament_id, ( SELECT public.current_profile_id() AS uid)));

DROP POLICY game_suspensions_scorer_insert ON public.game_suspensions;
CREATE POLICY game_suspensions_scorer_insert ON public.game_suspensions AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((is_tournament_director(tournament_id, ( SELECT public.current_profile_id() AS uid)) OR (EXISTS ( SELECT 1
   FROM tournament_roles r
  WHERE ((r.tournament_id = game_suspensions.tournament_id) AND (r.user_id = ( SELECT public.current_profile_id() AS uid)) AND (r.role = 'scorer'::text))))));

DROP POLICY games_director_delete ON public.games;
CREATE POLICY games_director_delete ON public.games AS PERMISSIVE FOR DELETE TO public
  USING (((tournament_id IS NULL) OR is_tournament_director(tournament_id, ( SELECT public.current_profile_id() AS uid))));

DROP POLICY games_director_update ON public.games;
CREATE POLICY games_director_update ON public.games AS PERMISSIVE FOR UPDATE TO public
  USING (((tournament_id IS NULL) OR (is_tournament_director(tournament_id, ( SELECT public.current_profile_id() AS uid)) AND (EXISTS ( SELECT 1
   FROM tournaments t
  WHERE ((t.id = games.tournament_id) AND (t.is_activated = true)))))))
  WITH CHECK (((tournament_id IS NULL) OR (is_tournament_director(tournament_id, ( SELECT public.current_profile_id() AS uid)) AND (EXISTS ( SELECT 1
   FROM tournaments t
  WHERE ((t.id = games.tournament_id) AND (t.is_activated = true)))))));

DROP POLICY games_insert ON public.games;
CREATE POLICY games_insert ON public.games AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((tournament_id IS NULL) OR (EXISTS ( SELECT 1
   FROM tournaments t
  WHERE ((t.id = games.tournament_id) AND (t.director_id = ( SELECT public.current_profile_id() AS uid))))) OR (EXISTS ( SELECT 1
   FROM tournament_roles tr
  WHERE ((tr.tournament_id = games.tournament_id) AND (tr.user_id = ( SELECT public.current_profile_id() AS uid)) AND (tr.role = ANY (ARRAY['director'::text, 'scorer'::text])))))));

DROP POLICY games_scorer_update ON public.games;
CREATE POLICY games_scorer_update ON public.games AS PERMISSIVE FOR UPDATE TO public
  USING ((((( SELECT public.current_profile_id() AS uid) = scorekeeper_id) OR (EXISTS ( SELECT 1
   FROM tournament_roles tr
  WHERE ((tr.tournament_id = games.tournament_id) AND (tr.user_id = ( SELECT public.current_profile_id() AS uid)) AND (tr.role = ANY (ARRAY['director'::text, 'scorer'::text])))))) AND (EXISTS ( SELECT 1
   FROM tournaments t
  WHERE ((t.id = games.tournament_id) AND (t.is_activated = true))))));

DROP POLICY gamesheet_game_map_director_all ON public.gamesheet_game_map;
CREATE POLICY gamesheet_game_map_director_all ON public.gamesheet_game_map AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM gamesheet_links l
  WHERE ((l.id = gamesheet_game_map.link_id) AND is_tournament_director(l.tournament_id, ( SELECT public.current_profile_id() AS uid))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM gamesheet_links l
  WHERE ((l.id = gamesheet_game_map.link_id) AND is_tournament_director(l.tournament_id, ( SELECT public.current_profile_id() AS uid))))));

DROP POLICY gamesheet_links_director_all ON public.gamesheet_links;
CREATE POLICY gamesheet_links_director_all ON public.gamesheet_links AS PERMISSIVE FOR ALL TO public
  USING (is_tournament_director(tournament_id, ( SELECT public.current_profile_id() AS uid)))
  WITH CHECK (is_tournament_director(tournament_id, ( SELECT public.current_profile_id() AS uid)));

DROP POLICY league_divisions_write ON public.league_divisions;
CREATE POLICY league_divisions_write ON public.league_divisions AS PERMISSIVE FOR ALL TO authenticated
  USING (is_league_manager(league_id, ( SELECT public.current_profile_id() AS uid)))
  WITH CHECK (is_league_manager(league_id, ( SELECT public.current_profile_id() AS uid)));

DROP POLICY league_games_delete ON public.league_games;
CREATE POLICY league_games_delete ON public.league_games AS PERMISSIVE FOR DELETE TO public
  USING (is_league_manager(league_id, ( SELECT public.current_profile_id() AS uid)));

DROP POLICY league_games_insert ON public.league_games;
CREATE POLICY league_games_insert ON public.league_games AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_league_manager(league_id, ( SELECT public.current_profile_id() AS uid)));

DROP POLICY league_games_update ON public.league_games;
CREATE POLICY league_games_update ON public.league_games AS PERMISSIVE FOR UPDATE TO public
  USING (((is_league_manager(league_id, ( SELECT public.current_profile_id() AS uid)) OR ((scorekeeper_id IS NOT NULL) AND (scorekeeper_id = ( SELECT public.current_profile_id() AS uid))) OR (EXISTS ( SELECT 1
   FROM league_roles lr
  WHERE ((lr.league_id = league_games.league_id) AND (lr.user_id = ( SELECT public.current_profile_id() AS uid)) AND (lr.role = 'scorer'::text))))) AND (EXISTS ( SELECT 1
   FROM leagues l
  WHERE ((l.id = league_games.league_id) AND (l.is_activated = true))))))
  WITH CHECK (((is_league_manager(league_id, ( SELECT public.current_profile_id() AS uid)) OR ((scorekeeper_id IS NOT NULL) AND (scorekeeper_id = ( SELECT public.current_profile_id() AS uid))) OR (EXISTS ( SELECT 1
   FROM league_roles lr
  WHERE ((lr.league_id = league_games.league_id) AND (lr.user_id = ( SELECT public.current_profile_id() AS uid)) AND (lr.role = 'scorer'::text))))) AND (EXISTS ( SELECT 1
   FROM leagues l
  WHERE ((l.id = league_games.league_id) AND (l.is_activated = true))))));

DROP POLICY league_registrations_commissioner_read ON public.league_registrations;
CREATE POLICY league_registrations_commissioner_read ON public.league_registrations AS PERMISSIVE FOR SELECT TO public
  USING (is_league_commissioner(league_id, ( SELECT public.current_profile_id() AS uid)));

DROP POLICY league_registrations_commissioner_update ON public.league_registrations;
CREATE POLICY league_registrations_commissioner_update ON public.league_registrations AS PERMISSIVE FOR UPDATE TO public
  USING (is_league_commissioner(league_id, ( SELECT public.current_profile_id() AS uid)))
  WITH CHECK (is_league_commissioner(league_id, ( SELECT public.current_profile_id() AS uid)));

DROP POLICY league_roles_commissioner_read ON public.league_roles;
CREATE POLICY league_roles_commissioner_read ON public.league_roles AS PERMISSIVE FOR SELECT TO public
  USING (is_league_commissioner(league_id, ( SELECT public.current_profile_id() AS uid)));

DROP POLICY league_roles_delete ON public.league_roles;
CREATE POLICY league_roles_delete ON public.league_roles AS PERMISSIVE FOR DELETE TO public
  USING ((is_league_commissioner(league_id, ( SELECT public.current_profile_id() AS uid)) AND (NOT (EXISTS ( SELECT 1
   FROM leagues l
  WHERE ((l.id = league_roles.league_id) AND (l.commissioner_id = league_roles.user_id) AND (league_roles.role = 'commissioner'::text)))))));

DROP POLICY league_roles_insert ON public.league_roles;
CREATE POLICY league_roles_insert ON public.league_roles AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_league_commissioner(league_id, ( SELECT public.current_profile_id() AS uid)));

DROP POLICY league_roles_read_own ON public.league_roles;
CREATE POLICY league_roles_read_own ON public.league_roles AS PERMISSIVE FOR SELECT TO public
  USING ((user_id = ( SELECT public.current_profile_id() AS uid)));

DROP POLICY league_subscriptions_delete_self ON public.league_subscriptions;
CREATE POLICY league_subscriptions_delete_self ON public.league_subscriptions AS PERMISSIVE FOR DELETE TO public
  USING ((( SELECT public.current_profile_id() AS uid) = user_id));

DROP POLICY league_subscriptions_insert_self ON public.league_subscriptions;
CREATE POLICY league_subscriptions_insert_self ON public.league_subscriptions AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT public.current_profile_id() AS uid) = user_id));

DROP POLICY league_subscriptions_select_own ON public.league_subscriptions;
CREATE POLICY league_subscriptions_select_own ON public.league_subscriptions AS PERMISSIVE FOR SELECT TO public
  USING ((( SELECT public.current_profile_id() AS uid) = user_id));

DROP POLICY league_teams_delete ON public.league_teams;
CREATE POLICY league_teams_delete ON public.league_teams AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_league_manager(league_id, ( SELECT public.current_profile_id() AS uid)));

DROP POLICY league_teams_insert ON public.league_teams;
CREATE POLICY league_teams_insert ON public.league_teams AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT public.current_profile_id() AS uid) IS NOT NULL));

DROP POLICY league_teams_update ON public.league_teams;
CREATE POLICY league_teams_update ON public.league_teams AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_league_manager(league_id, ( SELECT public.current_profile_id() AS uid)))
  WITH CHECK (is_league_manager(league_id, ( SELECT public.current_profile_id() AS uid)));

DROP POLICY leagues_insert ON public.leagues;
CREATE POLICY leagues_insert ON public.leagues AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT public.current_profile_id() AS uid) = commissioner_id));

DROP POLICY leagues_update ON public.leagues;
CREATE POLICY leagues_update ON public.leagues AS PERMISSIVE FOR UPDATE TO public
  USING (is_league_commissioner(id, ( SELECT public.current_profile_id() AS uid)));

DROP POLICY "Authenticated users can like" ON public.likes;
CREATE POLICY "Authenticated users can like" ON public.likes AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT public.current_profile_id() AS uid) = user_id));

DROP POLICY "Users can unlike their own likes" ON public.likes;
CREATE POLICY "Users can unlike their own likes" ON public.likes AS PERMISSIVE FOR DELETE TO public
  USING ((( SELECT public.current_profile_id() AS uid) = user_id));

DROP POLICY "Users create their own likes" ON public.likes;
CREATE POLICY "Users create their own likes" ON public.likes AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT public.current_profile_id() AS uid) = user_id));

DROP POLICY "Users delete their own likes" ON public.likes;
CREATE POLICY "Users delete their own likes" ON public.likes AS PERMISSIVE FOR DELETE TO public
  USING ((( SELECT public.current_profile_id() AS uid) = user_id));

DROP POLICY msg_insert ON public.messages;
CREATE POLICY msg_insert ON public.messages AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((sender_id = ( SELECT public.current_profile_id() AS uid)) AND is_conversation_participant(conversation_id)));

DROP POLICY moderation_blocklist_read_admin ON public.moderation_blocklist;
CREATE POLICY moderation_blocklist_read_admin ON public.moderation_blocklist AS PERMISSIVE FOR SELECT TO public
  USING (is_commissioner(( SELECT public.current_profile_id() AS uid)));

DROP POLICY moderation_blocklist_write_admin ON public.moderation_blocklist;
CREATE POLICY moderation_blocklist_write_admin ON public.moderation_blocklist AS PERMISSIVE FOR ALL TO public
  USING (is_commissioner(( SELECT public.current_profile_id() AS uid)))
  WITH CHECK (is_commissioner(( SELECT public.current_profile_id() AS uid)));

DROP POLICY moderation_settings_read_admin ON public.moderation_settings;
CREATE POLICY moderation_settings_read_admin ON public.moderation_settings AS PERMISSIVE FOR SELECT TO public
  USING (is_commissioner(( SELECT public.current_profile_id() AS uid)));

DROP POLICY moderation_settings_write_admin ON public.moderation_settings;
CREATE POLICY moderation_settings_write_admin ON public.moderation_settings AS PERMISSIVE FOR UPDATE TO public
  USING (is_commissioner(( SELECT public.current_profile_id() AS uid)))
  WITH CHECK (is_commissioner(( SELECT public.current_profile_id() AS uid)));

DROP POLICY nav_pins_delete_own ON public.nav_pins;
CREATE POLICY nav_pins_delete_own ON public.nav_pins AS PERMISSIVE FOR DELETE TO public
  USING ((user_id = ( SELECT public.current_profile_id() AS uid)));

DROP POLICY nav_pins_insert_own ON public.nav_pins;
CREATE POLICY nav_pins_insert_own ON public.nav_pins AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((user_id = ( SELECT public.current_profile_id() AS uid)));

DROP POLICY nav_pins_select_own ON public.nav_pins;
CREATE POLICY nav_pins_select_own ON public.nav_pins AS PERMISSIVE FOR SELECT TO public
  USING ((user_id = ( SELECT public.current_profile_id() AS uid)));

DROP POLICY nav_pins_update_own ON public.nav_pins;
CREATE POLICY nav_pins_update_own ON public.nav_pins AS PERMISSIVE FOR UPDATE TO public
  USING ((user_id = ( SELECT public.current_profile_id() AS uid)))
  WITH CHECK ((user_id = ( SELECT public.current_profile_id() AS uid)));

DROP POLICY notifications_delete_own ON public.notifications;
CREATE POLICY notifications_delete_own ON public.notifications AS PERMISSIVE FOR DELETE TO public
  USING ((( SELECT public.current_profile_id() AS uid) = recipient_id));

DROP POLICY notifications_read_own ON public.notifications;
CREATE POLICY notifications_read_own ON public.notifications AS PERMISSIVE FOR SELECT TO public
  USING ((( SELECT public.current_profile_id() AS uid) = recipient_id));

DROP POLICY notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own ON public.notifications AS PERMISSIVE FOR UPDATE TO public
  USING ((( SELECT public.current_profile_id() AS uid) = recipient_id))
  WITH CHECK ((( SELECT public.current_profile_id() AS uid) = recipient_id));

DROP POLICY onboarding_emails_owner_read ON public.onboarding_emails_sent;
CREATE POLICY onboarding_emails_owner_read ON public.onboarding_emails_sent AS PERMISSIVE FOR SELECT TO public
  USING ((( SELECT public.current_profile_id() AS uid) = user_id));

DROP POLICY order_items_select_own ON public.order_items;
CREATE POLICY order_items_select_own ON public.order_items AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND (o.buyer_profile_id = ( SELECT public.current_profile_id() AS uid))))));

DROP POLICY orders_select_own ON public.orders;
CREATE POLICY orders_select_own ON public.orders AS PERMISSIVE FOR SELECT TO public
  USING ((buyer_profile_id = ( SELECT public.current_profile_id() AS uid)));

DROP POLICY post_mentions_insert ON public.post_mentions;
CREATE POLICY post_mentions_insert ON public.post_mentions AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM posts p
  WHERE ((p.id = post_mentions.post_id) AND (p.author_id = ( SELECT public.current_profile_id() AS uid))))));

DROP POLICY "Users add their own reactions" ON public.post_reactions;
CREATE POLICY "Users add their own reactions" ON public.post_reactions AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT public.current_profile_id() AS uid) = user_id));

DROP POLICY "Users remove their own reactions" ON public.post_reactions;
CREATE POLICY "Users remove their own reactions" ON public.post_reactions AS PERMISSIVE FOR DELETE TO public
  USING ((( SELECT public.current_profile_id() AS uid) = user_id));

DROP POLICY "Authenticated users can create posts" ON public.posts;
CREATE POLICY "Authenticated users can create posts" ON public.posts AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT public.current_profile_id() AS uid) = author_id));

DROP POLICY "Users can delete their own posts" ON public.posts;
CREATE POLICY "Users can delete their own posts" ON public.posts AS PERMISSIVE FOR DELETE TO public
  USING ((( SELECT public.current_profile_id() AS uid) = author_id));

DROP POLICY "Users create their own posts" ON public.posts;
CREATE POLICY "Users create their own posts" ON public.posts AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT public.current_profile_id() AS uid) = author_id));

DROP POLICY "Users delete their own posts" ON public.posts;
CREATE POLICY "Users delete their own posts" ON public.posts AS PERMISSIVE FOR DELETE TO public
  USING ((( SELECT public.current_profile_id() AS uid) = author_id));

DROP POLICY "Users update their own posts" ON public.posts;
CREATE POLICY "Users update their own posts" ON public.posts AS PERMISSIVE FOR UPDATE TO public
  USING ((( SELECT public.current_profile_id() AS uid) = author_id));

DROP POLICY posts_delete_own ON public.posts;
CREATE POLICY posts_delete_own ON public.posts AS PERMISSIVE FOR DELETE TO public
  USING ((( SELECT public.current_profile_id() AS uid) = author_id));

DROP POLICY posts_insert_own ON public.posts;
CREATE POLICY posts_insert_own ON public.posts AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT public.current_profile_id() AS uid) = author_id));

DROP POLICY posts_select_all ON public.posts;
CREATE POLICY posts_select_all ON public.posts AS PERMISSIVE FOR SELECT TO public
  USING (((is_hidden = false) OR (( SELECT public.current_profile_id() AS uid) = author_id) OR is_commissioner(( SELECT public.current_profile_id() AS uid))));

DROP POLICY posts_update_own ON public.posts;
CREATE POLICY posts_update_own ON public.posts AS PERMISSIVE FOR UPDATE TO public
  USING ((( SELECT public.current_profile_id() AS uid) = author_id))
  WITH CHECK ((( SELECT public.current_profile_id() AS uid) = author_id));

DROP POLICY "Users manage own subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users manage own subscriptions" ON public.push_subscriptions AS PERMISSIVE FOR ALL TO public
  USING ((( SELECT public.current_profile_id() AS uid) = user_id));

DROP POLICY rinks_insert ON public.rinks;
CREATE POLICY rinks_insert ON public.rinks AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT public.current_profile_id() AS uid) IS NOT NULL));

DROP POLICY rinkside_articles_delete_own ON public.rinkside_articles;
CREATE POLICY rinkside_articles_delete_own ON public.rinkside_articles AS PERMISSIVE FOR DELETE TO public
  USING ((( SELECT public.current_profile_id() AS uid) = author_id));

DROP POLICY rinkside_articles_insert_author ON public.rinkside_articles;
CREATE POLICY rinkside_articles_insert_author ON public.rinkside_articles AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT public.current_profile_id() AS uid) = author_id));

DROP POLICY rinkside_articles_read_own ON public.rinkside_articles;
CREATE POLICY rinkside_articles_read_own ON public.rinkside_articles AS PERMISSIVE FOR SELECT TO public
  USING ((( SELECT public.current_profile_id() AS uid) = author_id));

DROP POLICY rinkside_articles_update_own ON public.rinkside_articles;
CREATE POLICY rinkside_articles_update_own ON public.rinkside_articles AS PERMISSIVE FOR UPDATE TO public
  USING ((( SELECT public.current_profile_id() AS uid) = author_id))
  WITH CHECK ((( SELECT public.current_profile_id() AS uid) = author_id));

DROP POLICY stripe_connect_accounts_owner_read ON public.stripe_connect_accounts;
CREATE POLICY stripe_connect_accounts_owner_read ON public.stripe_connect_accounts AS PERMISSIVE FOR SELECT TO public
  USING ((owner_profile_id = ( SELECT public.current_profile_id() AS uid)));

DROP POLICY survey_read_admin ON public.survey_responses;
CREATE POLICY survey_read_admin ON public.survey_responses AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT public.current_profile_id() AS uid)) AND (p.is_admin = true)))));

DROP POLICY rsvp_user_delete ON public.team_game_rsvps;
CREATE POLICY rsvp_user_delete ON public.team_game_rsvps AS PERMISSIVE FOR DELETE TO public
  USING ((( SELECT public.current_profile_id() AS uid) = user_id));

DROP POLICY rsvp_user_insert ON public.team_game_rsvps;
CREATE POLICY rsvp_user_insert ON public.team_game_rsvps AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT public.current_profile_id() AS uid) = user_id));

DROP POLICY rsvp_user_update ON public.team_game_rsvps;
CREATE POLICY rsvp_user_update ON public.team_game_rsvps AS PERMISSIVE FOR UPDATE TO public
  USING ((( SELECT public.current_profile_id() AS uid) = user_id));

DROP POLICY team_games_insert ON public.team_games;
CREATE POLICY team_games_insert ON public.team_games AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM team_members tm
  WHERE ((tm.team_id = team_games.team_id) AND (tm.user_id = ( SELECT public.current_profile_id() AS uid)) AND (tm.role = ANY (ARRAY['manager'::text, 'coach'::text]))))));

DROP POLICY team_join_requests_insert ON public.team_join_requests;
CREATE POLICY team_join_requests_insert ON public.team_join_requests AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT public.current_profile_id() AS uid) = user_id));

DROP POLICY team_join_requests_read ON public.team_join_requests;
CREATE POLICY team_join_requests_read ON public.team_join_requests AS PERMISSIVE FOR SELECT TO public
  USING (((user_id = ( SELECT public.current_profile_id() AS uid)) OR is_team_manager(team_id, ( SELECT public.current_profile_id() AS uid)) OR is_league_commissioner_of_team(team_id, ( SELECT public.current_profile_id() AS uid))));

DROP POLICY team_join_requests_update ON public.team_join_requests;
CREATE POLICY team_join_requests_update ON public.team_join_requests AS PERMISSIVE FOR UPDATE TO public
  USING ((is_team_manager(team_id, ( SELECT public.current_profile_id() AS uid)) OR is_league_commissioner_of_team(team_id, ( SELECT public.current_profile_id() AS uid))))
  WITH CHECK ((is_team_manager(team_id, ( SELECT public.current_profile_id() AS uid)) OR is_league_commissioner_of_team(team_id, ( SELECT public.current_profile_id() AS uid))));

DROP POLICY team_members_insert_by_manager ON public.team_members;
CREATE POLICY team_members_insert_by_manager ON public.team_members AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((is_team_manager(team_id, ( SELECT public.current_profile_id() AS uid)) OR is_league_commissioner_of_team(team_id, ( SELECT public.current_profile_id() AS uid))));

DROP POLICY team_members_manager_delete ON public.team_members;
CREATE POLICY team_members_manager_delete ON public.team_members AS PERMISSIVE FOR DELETE TO public
  USING ((is_team_manager(team_id, ( SELECT public.current_profile_id() AS uid)) AND (NOT (EXISTS ( SELECT 1
   FROM teams t
  WHERE ((t.id = team_members.team_id) AND (t.manager_id = team_members.user_id) AND (team_members.role = 'manager'::text)))))));

DROP POLICY team_members_manager_update ON public.team_members;
CREATE POLICY team_members_manager_update ON public.team_members AS PERMISSIVE FOR UPDATE TO public
  USING (is_team_manager(team_id, ( SELECT public.current_profile_id() AS uid)))
  WITH CHECK (is_team_manager(team_id, ( SELECT public.current_profile_id() AS uid)));

DROP POLICY teams_insert ON public.teams;
CREATE POLICY teams_insert ON public.teams AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT public.current_profile_id() AS uid) = manager_id));

DROP POLICY teams_manager_update ON public.teams;
CREATE POLICY teams_manager_update ON public.teams AS PERMISSIVE FOR UPDATE TO public
  USING (is_team_manager(id, ( SELECT public.current_profile_id() AS uid)))
  WITH CHECK (is_team_manager(id, ( SELECT public.current_profile_id() AS uid)));

DROP POLICY tournament_divisions_director_delete ON public.tournament_divisions;
CREATE POLICY tournament_divisions_director_delete ON public.tournament_divisions AS PERMISSIVE FOR DELETE TO public
  USING (is_tournament_director(tournament_id, ( SELECT public.current_profile_id() AS uid)));

DROP POLICY tournament_divisions_director_insert ON public.tournament_divisions;
CREATE POLICY tournament_divisions_director_insert ON public.tournament_divisions AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_tournament_director(tournament_id, ( SELECT public.current_profile_id() AS uid)));

DROP POLICY tournament_divisions_director_update ON public.tournament_divisions;
CREATE POLICY tournament_divisions_director_update ON public.tournament_divisions AS PERMISSIVE FOR UPDATE TO public
  USING (is_tournament_director(tournament_id, ( SELECT public.current_profile_id() AS uid)))
  WITH CHECK (is_tournament_director(tournament_id, ( SELECT public.current_profile_id() AS uid)));

DROP POLICY tournament_registrations_director_read ON public.tournament_registrations;
CREATE POLICY tournament_registrations_director_read ON public.tournament_registrations AS PERMISSIVE FOR SELECT TO public
  USING (is_tournament_director(tournament_id, ( SELECT public.current_profile_id() AS uid)));

DROP POLICY tournament_registrations_director_update ON public.tournament_registrations;
CREATE POLICY tournament_registrations_director_update ON public.tournament_registrations AS PERMISSIVE FOR UPDATE TO public
  USING (is_tournament_director(tournament_id, ( SELECT public.current_profile_id() AS uid)))
  WITH CHECK (is_tournament_director(tournament_id, ( SELECT public.current_profile_id() AS uid)));

DROP POLICY roles_delete ON public.tournament_roles;
CREATE POLICY roles_delete ON public.tournament_roles AS PERMISSIVE FOR DELETE TO public
  USING ((is_tournament_director(tournament_id, ( SELECT public.current_profile_id() AS uid)) AND (NOT (EXISTS ( SELECT 1
   FROM tournaments t
  WHERE ((t.id = tournament_roles.tournament_id) AND (t.director_id = tournament_roles.user_id) AND (tournament_roles.role = 'director'::text)))))));

DROP POLICY roles_director_read ON public.tournament_roles;
CREATE POLICY roles_director_read ON public.tournament_roles AS PERMISSIVE FOR SELECT TO public
  USING (is_tournament_director(tournament_id, ( SELECT public.current_profile_id() AS uid)));

DROP POLICY roles_insert ON public.tournament_roles;
CREATE POLICY roles_insert ON public.tournament_roles AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_tournament_director(tournament_id, ( SELECT public.current_profile_id() AS uid)));

DROP POLICY roles_read_own ON public.tournament_roles;
CREATE POLICY roles_read_own ON public.tournament_roles AS PERMISSIVE FOR SELECT TO public
  USING ((user_id = ( SELECT public.current_profile_id() AS uid)));

DROP POLICY tournament_subscriptions_delete_self ON public.tournament_subscriptions;
CREATE POLICY tournament_subscriptions_delete_self ON public.tournament_subscriptions AS PERMISSIVE FOR DELETE TO public
  USING ((( SELECT public.current_profile_id() AS uid) = user_id));

DROP POLICY tournament_subscriptions_insert_self ON public.tournament_subscriptions;
CREATE POLICY tournament_subscriptions_insert_self ON public.tournament_subscriptions AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT public.current_profile_id() AS uid) = user_id));

DROP POLICY tournament_subscriptions_select_own ON public.tournament_subscriptions;
CREATE POLICY tournament_subscriptions_select_own ON public.tournament_subscriptions AS PERMISSIVE FOR SELECT TO public
  USING ((( SELECT public.current_profile_id() AS uid) = user_id));

DROP POLICY teams_insert ON public.tournament_teams;
CREATE POLICY teams_insert ON public.tournament_teams AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT public.current_profile_id() AS uid) IS NOT NULL));

DROP POLICY tournament_teams_director_delete ON public.tournament_teams;
CREATE POLICY tournament_teams_director_delete ON public.tournament_teams AS PERMISSIVE FOR DELETE TO public
  USING (is_tournament_director(tournament_id, ( SELECT public.current_profile_id() AS uid)));

DROP POLICY tournament_teams_director_update ON public.tournament_teams;
CREATE POLICY tournament_teams_director_update ON public.tournament_teams AS PERMISSIVE FOR UPDATE TO public
  USING (is_tournament_director(tournament_id, ( SELECT public.current_profile_id() AS uid)))
  WITH CHECK (is_tournament_director(tournament_id, ( SELECT public.current_profile_id() AS uid)));

DROP POLICY tournaments_director_delete ON public.tournaments;
CREATE POLICY tournaments_director_delete ON public.tournaments AS PERMISSIVE FOR DELETE TO public
  USING ((( SELECT public.current_profile_id() AS uid) = director_id));

DROP POLICY tournaments_director_read ON public.tournaments;
CREATE POLICY tournaments_director_read ON public.tournaments AS PERMISSIVE FOR SELECT TO public
  USING (is_tournament_director(id, ( SELECT public.current_profile_id() AS uid)));

DROP POLICY tournaments_director_update ON public.tournaments;
CREATE POLICY tournaments_director_update ON public.tournaments AS PERMISSIVE FOR UPDATE TO public
  USING (is_tournament_director(id, ( SELECT public.current_profile_id() AS uid)))
  WITH CHECK (is_tournament_director(id, ( SELECT public.current_profile_id() AS uid)));

DROP POLICY tournaments_insert ON public.tournaments;
CREATE POLICY tournaments_insert ON public.tournaments AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT public.current_profile_id() AS uid) = director_id));

DROP POLICY user_blocks_delete_own ON public.user_blocks;
CREATE POLICY user_blocks_delete_own ON public.user_blocks AS PERMISSIVE FOR DELETE TO public
  USING ((blocker_id = ( SELECT public.current_profile_id() AS uid)));

DROP POLICY user_blocks_insert_own ON public.user_blocks;
CREATE POLICY user_blocks_insert_own ON public.user_blocks AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((blocker_id = ( SELECT public.current_profile_id() AS uid)));

DROP POLICY user_blocks_select_own ON public.user_blocks;
CREATE POLICY user_blocks_select_own ON public.user_blocks AS PERMISSIVE FOR SELECT TO public
  USING (((blocker_id = ( SELECT public.current_profile_id() AS uid)) OR (blocked_id = ( SELECT public.current_profile_id() AS uid))));

DROP POLICY volunteer_slots_delete ON public.volunteer_slots;
CREATE POLICY volunteer_slots_delete ON public.volunteer_slots AS PERMISSIVE FOR DELETE TO public
  USING (is_team_manager(team_id, ( SELECT public.current_profile_id() AS uid)));

DROP POLICY volunteer_slots_insert_by_manager ON public.volunteer_slots;
CREATE POLICY volunteer_slots_insert_by_manager ON public.volunteer_slots AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_team_manager(team_id, ( SELECT public.current_profile_id() AS uid)));

DROP POLICY volunteer_slots_update ON public.volunteer_slots;
CREATE POLICY volunteer_slots_update ON public.volunteer_slots AS PERMISSIVE FOR UPDATE TO public
  USING (((assigned_user_id = ( SELECT public.current_profile_id() AS uid)) OR is_team_manager(team_id, ( SELECT public.current_profile_id() AS uid))))
  WITH CHECK ((is_team_manager(team_id, ( SELECT public.current_profile_id() AS uid)) OR (assigned_user_id IS NULL) OR (assigned_user_id = ( SELECT public.current_profile_id() AS uid))));

-- ============================================================================
-- Regenerator (read-only; run via MCP execute_sql against prod):
--
-- SELECT format(E'DROP POLICY %I ON public.%I;\nCREATE POLICY %I ON public.%I AS %s FOR %s TO %s%s%s;\n',
--   policyname, tablename, policyname, tablename, permissive, cmd,
--   array_to_string(roles, ', '),
--   COALESCE(E'\n  USING (' || regexp_replace(regexp_replace(qual, '\(\s*SELECT\s+auth\.uid\(\)\s+AS\s+uid\s*\)', '( SELECT public.current_profile_id() AS uid)', 'gi'), 'auth\.uid\(\)', '( SELECT public.current_profile_id() )', 'g') || E')', ''),
--   COALESCE(E'\n  WITH CHECK (' || regexp_replace(regexp_replace(with_check, '\(\s*SELECT\s+auth\.uid\(\)\s+AS\s+uid\s*\)', '( SELECT public.current_profile_id() AS uid)', 'gi'), 'auth\.uid\(\)', '( SELECT public.current_profile_id() )', 'g') || E')', ''))
-- FROM pg_policies
-- WHERE schemaname='public' AND tablename <> 'profiles'
--   AND (qual ILIKE '%auth.uid()%' OR with_check ILIKE '%auth.uid()%')
-- ORDER BY tablename, policyname;
-- ============================================================================
