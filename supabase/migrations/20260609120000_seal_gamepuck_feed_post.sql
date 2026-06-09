-- GAMEPUCK-2: seal the auto-posted Game Puck result in the feed. The reveal on
-- the game card hides the winner until you peel the tape — but the feed post used
-- to name the winner on settle, spoiling it platform-wide. Make the post a
-- name-less TEASER that links to the game card (where the peel lives).
--
-- New column posts.gamepuck_reveal_game_id (no FK — audit/link col only; a 2nd FK
-- from posts to a games table would make the feed's bare profiles() embed
-- ambiguous, the Jun 2 footgun). The feed render keys league-vs-tournament off
-- the post's league_id, same as recap posts.

ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS gamepuck_reveal_game_id uuid;

CREATE OR REPLACE FUNCTION public.settle_game_puck(p_game_id uuid, p_kind text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'auth' AS $$
declare
  v_is_league boolean := (p_kind = 'league');
  v_opened timestamptz;
  v_team_id uuid; v_jersey int; v_votes int; v_total int;
  v_user uuid; v_name text;
  v_tournament uuid; v_league uuid; v_author uuid; v_team_name text; v_global_team uuid;
  v_post uuid; v_result uuid;
begin
  IF v_is_league THEN
    IF EXISTS (SELECT 1 FROM game_puck_results WHERE league_game_id = p_game_id) THEN RETURN null; END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM game_puck_results WHERE game_id = p_game_id) THEN RETURN null; END IF;
  END IF;

  -- Window guard: only settle once the 30-min window (from the first vote) has closed.
  SELECT min(created_at) INTO v_opened FROM game_puck_votes
  WHERE (v_is_league AND league_game_id = p_game_id) OR (NOT v_is_league AND game_id = p_game_id);
  IF v_opened IS NULL OR now() < v_opened + interval '30 minutes' THEN RETURN null; END IF;

  SELECT coalesce(voted_tournament_team_id, voted_league_team_id), voted_jersey, count(*)::int
    INTO v_team_id, v_jersey, v_votes
  FROM game_puck_votes
  WHERE (v_is_league AND league_game_id = p_game_id) OR (NOT v_is_league AND game_id = p_game_id)
  GROUP BY 1, 2 ORDER BY count(*) DESC, voted_jersey ASC LIMIT 1;
  IF v_team_id IS NULL THEN RETURN null; END IF;

  SELECT count(*)::int INTO v_total FROM game_puck_votes
  WHERE (v_is_league AND league_game_id = p_game_id) OR (NOT v_is_league AND game_id = p_game_id);

  IF v_is_league THEN
    SELECT league_id INTO v_league FROM league_games WHERE id = p_game_id;
    SELECT commissioner_id INTO v_author FROM leagues WHERE id = v_league;
    SELECT lt.team_id, coalesce(t.name, lt.team_name) INTO v_global_team, v_team_name
      FROM league_teams lt LEFT JOIN teams t ON t.id = lt.team_id WHERE lt.id = v_team_id;
    IF v_global_team IS NOT NULL THEN
      SELECT tm.user_id, coalesce(p.name, tm.invite_name) INTO v_user, v_name
        FROM team_members tm LEFT JOIN profiles p ON p.id = tm.user_id
        WHERE tm.team_id = v_global_team AND tm.jersey_number = v_jersey
        ORDER BY (tm.user_id IS NOT NULL) DESC LIMIT 1;
    END IF;
  ELSE
    SELECT tournament_id INTO v_tournament FROM games WHERE id = p_game_id;
    SELECT director_id INTO v_author FROM tournaments WHERE id = v_tournament;
    SELECT team_name INTO v_team_name FROM tournament_teams WHERE id = v_team_id;
    SELECT gl.user_id, coalesce(p.name, gl.invite_name) INTO v_user, v_name
      FROM game_lineups gl LEFT JOIN profiles p ON p.id = gl.user_id
      WHERE gl.game_id = p_game_id AND gl.jersey_number = v_jersey
      ORDER BY (gl.user_id IS NOT NULL) DESC LIMIT 1;
  END IF;

  INSERT INTO game_puck_results (game_id, league_game_id, kind, winner_tournament_team_id, winner_league_team_id, winner_jersey, winner_user_id, winner_name, votes, total_votes)
  VALUES (
    CASE WHEN v_is_league THEN null ELSE p_game_id END,
    CASE WHEN v_is_league THEN p_game_id ELSE null END,
    CASE WHEN v_is_league THEN 'league' ELSE 'tournament' END,
    CASE WHEN v_is_league THEN null ELSE v_team_id END,
    CASE WHEN v_is_league THEN v_team_id ELSE null END,
    v_jersey, v_user, v_name, v_votes, v_total
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_result;
  IF v_result IS NULL THEN RETURN null; END IF;

  -- SEALED feed post: a name-less teaser that drives people to the game card to
  -- peel. The winner is NOT named here. Links via gamepuck_reveal_game_id.
  IF v_author IS NOT NULL THEN
    INSERT INTO posts (author_id, content, tag, tag_color, tournament_id, league_id, gamepuck_reveal_game_id, created_at)
    VALUES (
      v_author,
      '🏒 A Fans'' Pick has been crowned — peel the tape to reveal the Game Puck winner.',
      'Game Puck', '#D72638', v_tournament, v_league, p_game_id, now()
    )
    RETURNING id INTO v_post;
    UPDATE game_puck_results SET post_id = v_post WHERE id = v_result;
  END IF;

  -- The winner's OWN notification still names their win (it's private to them).
  IF v_user IS NOT NULL THEN
    INSERT INTO notifications (recipient_id, actor_id, kind, url, body)
    VALUES (
      v_user, null, 'game_puck_won',
      CASE WHEN v_is_league THEN '/lg/' || p_game_id ELSE '/g/' || p_game_id END,
      '🏒 You won the Game Puck — Fans'' Pick' || CASE WHEN v_team_name IS NOT NULL THEN ' for ' || v_team_name ELSE '' END || '!'
    );
  END IF;

  RETURN v_result;
END;
$$;
