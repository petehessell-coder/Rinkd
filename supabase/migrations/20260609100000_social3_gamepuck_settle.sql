-- SOCIAL-3 — Game Puck Phase 2: settle the winner, auto-post, notify, lock, badge.
--
-- Phase 1 computes the winner LIVE on read (no record, no lock). Phase 2 adds a
-- one-time "settle" per game (auto, ~24h after final, via cron — see the separate
-- _cron migration) that records the winner, auto-posts the Fans' Pick to the scoped
-- feed, notifies + pushes the winner (when the jersey resolves to a real account),
-- and locks voting. Additive + DORMANT until the cron is scheduled.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Settled-winner record (one per game). Polymorphic, mirrors game_puck_votes.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE public.game_puck_results (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id                   uuid,            -- tournament games.id   (XOR league_game_id)
  league_game_id            uuid,            -- league_games.id
  kind                      text NOT NULL CHECK (kind IN ('tournament','league')),
  winner_tournament_team_id uuid,
  winner_league_team_id     uuid,
  winner_jersey             int  NOT NULL,
  winner_user_id            uuid REFERENCES public.profiles(id) ON DELETE SET NULL,  -- null = nameplate-only
  winner_name               text,
  votes                     int  NOT NULL DEFAULT 0,   -- votes for the winner
  total_votes               int  NOT NULL DEFAULT 0,
  post_id                   uuid REFERENCES public.posts(id) ON DELETE SET NULL,
  settled_at                timestamptz NOT NULL DEFAULT now(),
  CHECK ((game_id IS NOT NULL) <> (league_game_id IS NOT NULL))
);
CREATE UNIQUE INDEX game_puck_results_tournament_uniq ON public.game_puck_results (game_id) WHERE game_id IS NOT NULL;
CREATE UNIQUE INDEX game_puck_results_league_uniq     ON public.game_puck_results (league_game_id) WHERE league_game_id IS NOT NULL;
CREATE INDEX game_puck_results_winner_user           ON public.game_puck_results (winner_user_id) WHERE winner_user_id IS NOT NULL;
ALTER TABLE public.game_puck_results ENABLE ROW LEVEL SECURITY;
-- The winner is public (same as the live tally). Writes are SECURITY DEFINER only.
CREATE POLICY game_puck_results_read ON public.game_puck_results FOR SELECT USING (true);

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Settle ONE game (idempotent). Returns the result id, or null if not settled
--    (already settled / no votes / lost a race).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.settle_game_puck(p_game_id uuid, p_kind text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'auth' AS $$
declare
  v_is_league boolean := (p_kind = 'league');
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

  -- Leader: mirror get_game_puck ordering (votes desc, jersey asc).
  SELECT coalesce(voted_tournament_team_id, voted_league_team_id), voted_jersey, count(*)::int
    INTO v_team_id, v_jersey, v_votes
  FROM game_puck_votes
  WHERE (v_is_league AND league_game_id = p_game_id) OR (NOT v_is_league AND game_id = p_game_id)
  GROUP BY 1, 2
  ORDER BY count(*) DESC, voted_jersey ASC
  LIMIT 1;
  IF v_team_id IS NULL THEN RETURN null; END IF;  -- no votes, nothing to settle

  SELECT count(*)::int INTO v_total FROM game_puck_votes
  WHERE (v_is_league AND league_game_id = p_game_id) OR (NOT v_is_league AND game_id = p_game_id);

  -- Scope + auto-post author (event director/commissioner) + team name + jersey->user.
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

  -- Atomic idempotency: only the inserter proceeds to post + notify.
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

  -- Auto-post the Fans' Pick to the scoped feed (author = director/commissioner).
  IF v_author IS NOT NULL THEN
    INSERT INTO posts (author_id, content, tag, tag_color, tournament_id, league_id, created_at)
    VALUES (
      v_author,
      '🏒 Fans'' Pick: ' ||
        CASE WHEN v_name IS NOT NULL THEN v_name || ' ' ELSE '' END ||
        '#' || v_jersey ||
        CASE WHEN v_team_name IS NOT NULL THEN ' — ' || v_team_name ELSE '' END,
      'Game Puck', '#D72638', v_tournament, v_league, now()
    )
    RETURNING id INTO v_post;
    UPDATE game_puck_results SET post_id = v_post WHERE id = v_result;
  END IF;

  -- Notify + push the winner, only when the jersey resolved to a real account.
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

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Batch settle — what the cron calls. Final games, aged, with votes, unsettled.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.settle_due_game_pucks(p_min_age interval DEFAULT interval '24 hours')
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'auth' AS $$
declare v_count int := 0; r record;
begin
  FOR r IN
    SELECT g.id AS gid, 'tournament'::text AS kind
      FROM games g
      WHERE g.status = 'final' AND g.updated_at < now() - p_min_age
        AND EXISTS (SELECT 1 FROM game_puck_votes v WHERE v.game_id = g.id)
        AND NOT EXISTS (SELECT 1 FROM game_puck_results res WHERE res.game_id = g.id)
    UNION ALL
    SELECT lg.id, 'league'
      FROM league_games lg
      WHERE lg.status = 'final' AND lg.updated_at < now() - p_min_age
        AND EXISTS (SELECT 1 FROM game_puck_votes v WHERE v.league_game_id = lg.id)
        AND NOT EXISTS (SELECT 1 FROM game_puck_results res WHERE res.league_game_id = lg.id)
  LOOP
    IF public.settle_game_puck(r.gid, r.kind) IS NOT NULL THEN v_count := v_count + 1; END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Vote-lock: once settled, no more voting.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cast_game_puck_vote(p_game_id uuid, p_kind text, p_team_id uuid, p_jersey integer)
RETURNS void LANGUAGE plpgsql SET search_path TO 'public' AS $$
begin
  if p_kind = 'league' then
    if exists (select 1 from public.game_puck_results where league_game_id = p_game_id) then
      raise exception 'Game Puck voting has closed for this game' using errcode = '22023';
    end if;
    insert into public.game_puck_votes (voter_id, league_game_id, voted_league_team_id, voted_jersey)
    values ((select auth.uid()), p_game_id, p_team_id, p_jersey)
    on conflict (voter_id, league_game_id)
    do update set voted_league_team_id = excluded.voted_league_team_id,
                  voted_jersey         = excluded.voted_jersey,
                  updated_at           = now();
  else
    if exists (select 1 from public.game_puck_results where game_id = p_game_id) then
      raise exception 'Game Puck voting has closed for this game' using errcode = '22023';
    end if;
    insert into public.game_puck_votes (voter_id, game_id, voted_tournament_team_id, voted_jersey)
    values ((select auth.uid()), p_game_id, p_team_id, p_jersey)
    on conflict (voter_id, game_id)
    do update set voted_tournament_team_id = excluded.voted_tournament_team_id,
                  voted_jersey             = excluded.voted_jersey,
                  updated_at               = now();
  end if;
end;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Read helpers for the UI (settled winner per game + a player's career count).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_game_puck_result(p_game_id uuid, p_kind text)
RETURNS TABLE(team_id uuid, jersey int, winner_user_id uuid, winner_name text, votes int, total_votes int, settled_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(winner_tournament_team_id, winner_league_team_id), winner_jersey, winner_user_id, winner_name, votes, total_votes, settled_at
  FROM public.game_puck_results
  WHERE (p_kind = 'league' AND league_game_id = p_game_id) OR (p_kind <> 'league' AND game_id = p_game_id)
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_user_game_puck_count(p_user_id uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT count(*)::int FROM public.game_puck_results WHERE winner_user_id = p_user_id;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. Push the winner notification (add the kind to the existing push gate).
-- ───────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_enqueue_notification_push ON public.notifications;
CREATE TRIGGER trg_enqueue_notification_push
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  WHEN (new.kind = ANY (ARRAY['comment'::text, 'mention'::text, 'reaction'::text, 'message'::text,
                              'team_join_request'::text, 'team_join_approved'::text, 'team_join_denied'::text,
                              'game_puck_won'::text]))
  EXECUTE FUNCTION enqueue_notification_push();

-- ───────────────────────────────────────────────────────────────────────────
-- 7. Grants
-- ───────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.get_game_puck_result(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_game_puck_count(uuid)    TO anon, authenticated;
-- settle_game_puck / settle_due_game_pucks are cron/internal — no public grant.
