-- SOCIAL-3 → GAMEPUCK-2 reconcile: 30-min voting window + 10-min tally blackout,
-- replacing the 24h auto-settle. Window is anchored on the FIRST vote (reliable;
-- votes start when the game ends, so ≈ "30 min after the game ends"; a game with
-- no votes has no window). Phases: open (0-20m) → blackout (20-30m, tally hidden)
-- → closed (≥30m) → settled (winner recorded). Settle happens at close, via lazy
-- settle-on-view (any viewer past the window) + the cron as a backstop.

-- ── 1. State read for the card: phase + timing (drives open/blackout/closed UI) ──
CREATE OR REPLACE FUNCTION public.get_game_puck_state(p_game_id uuid, p_kind text)
RETURNS TABLE(opened_at timestamptz, closes_at timestamptz, phase text, total_votes int, is_settled boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  with v as (
    select min(created_at) as opened_at, count(*)::int as n
    from public.game_puck_votes
    where (p_kind = 'league' and league_game_id = p_game_id)
       or (p_kind <> 'league' and game_id = p_game_id)
  ),
  s as (
    select exists (
      select 1 from public.game_puck_results
      where (p_kind = 'league' and league_game_id = p_game_id)
         or (p_kind <> 'league' and game_id = p_game_id)
    ) as settled
  )
  select
    v.opened_at,
    v.opened_at + interval '30 minutes',
    case
      when (select settled from s)                              then 'settled'
      when v.opened_at is null                                  then 'none'
      when now() >= v.opened_at + interval '30 minutes'         then 'closed'
      when now() >= v.opened_at + interval '20 minutes'         then 'blackout'
      else 'open'
    end,
    v.n,
    (select settled from s)
  from v;
$$;

-- ── 2. settle_game_puck — add a window guard so it ONLY settles after the 30-min
--      window closes (safe to call from a client / lazy settle; idempotent). ─────
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

  IF v_author IS NOT NULL THEN
    INSERT INTO posts (author_id, content, tag, tag_color, tournament_id, league_id, created_at)
    VALUES (
      v_author,
      '🏒 Fans'' Pick: ' || CASE WHEN v_name IS NOT NULL THEN v_name || ' ' ELSE '' END || '#' || v_jersey
        || CASE WHEN v_team_name IS NOT NULL THEN ' — ' || v_team_name ELSE '' END,
      'Game Puck', '#D72638', v_tournament, v_league, now()
    )
    RETURNING id INTO v_post;
    UPDATE game_puck_results SET post_id = v_post WHERE id = v_result;
  END IF;

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

-- ── 3. Batch settle (cron) — 30-min window, first-vote-anchored ─────────────────
CREATE OR REPLACE FUNCTION public.settle_due_game_pucks(p_min_age interval DEFAULT interval '30 minutes')
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'auth' AS $$
declare v_count int := 0; r record;
begin
  FOR r IN
    SELECT g.id AS gid, 'tournament'::text AS kind
      FROM games g
      WHERE g.status = 'final'
        AND EXISTS (SELECT 1 FROM game_puck_votes v WHERE v.game_id = g.id)
        AND (SELECT min(created_at) FROM game_puck_votes v WHERE v.game_id = g.id) < now() - p_min_age
        AND NOT EXISTS (SELECT 1 FROM game_puck_results res WHERE res.game_id = g.id)
    UNION ALL
    SELECT lg.id, 'league'
      FROM league_games lg
      WHERE lg.status = 'final'
        AND EXISTS (SELECT 1 FROM game_puck_votes v WHERE v.league_game_id = lg.id)
        AND (SELECT min(created_at) FROM game_puck_votes v WHERE v.league_game_id = lg.id) < now() - p_min_age
        AND NOT EXISTS (SELECT 1 FROM game_puck_results res WHERE res.league_game_id = lg.id)
  LOOP
    IF public.settle_game_puck(r.gid, r.kind) IS NOT NULL THEN v_count := v_count + 1; END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

-- ── 4. cast_game_puck_vote — reject after the 30-min window closes (or settled) ──
CREATE OR REPLACE FUNCTION public.cast_game_puck_vote(p_game_id uuid, p_kind text, p_team_id uuid, p_jersey integer)
RETURNS void LANGUAGE plpgsql SET search_path TO 'public' AS $$
declare v_opened timestamptz;
begin
  if p_kind = 'league' then
    if exists (select 1 from public.game_puck_results where league_game_id = p_game_id) then
      raise exception 'Game Puck voting has closed for this game' using errcode = '22023';
    end if;
    select min(created_at) into v_opened from public.game_puck_votes where league_game_id = p_game_id;
    if v_opened is not null and now() >= v_opened + interval '30 minutes' then
      raise exception 'Game Puck voting has closed for this game' using errcode = '22023';
    end if;
    insert into public.game_puck_votes (voter_id, league_game_id, voted_league_team_id, voted_jersey)
    values ((select auth.uid()), p_game_id, p_team_id, p_jersey)
    on conflict (voter_id, league_game_id)
    do update set voted_league_team_id = excluded.voted_league_team_id, voted_jersey = excluded.voted_jersey, updated_at = now();
  else
    if exists (select 1 from public.game_puck_results where game_id = p_game_id) then
      raise exception 'Game Puck voting has closed for this game' using errcode = '22023';
    end if;
    select min(created_at) into v_opened from public.game_puck_votes where game_id = p_game_id;
    if v_opened is not null and now() >= v_opened + interval '30 minutes' then
      raise exception 'Game Puck voting has closed for this game' using errcode = '22023';
    end if;
    insert into public.game_puck_votes (voter_id, game_id, voted_tournament_team_id, voted_jersey)
    values ((select auth.uid()), p_game_id, p_team_id, p_jersey)
    on conflict (voter_id, game_id)
    do update set voted_tournament_team_id = excluded.voted_tournament_team_id, voted_jersey = excluded.voted_jersey, updated_at = now();
  end if;
end;
$$;

-- ── 5. Grants + cron cadence (every 5 min now; lazy settle handles viewed games) ─
GRANT EXECUTE ON FUNCTION public.get_game_puck_state(uuid, text) TO anon, authenticated;
-- settle_game_puck writes director-authored posts + win notifications: keep it off
-- PUBLIC/anon. Only signed-in viewers lazy-settle a closed-window game on view.
REVOKE EXECUTE ON FUNCTION public.settle_game_puck(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.settle_game_puck(uuid, text) TO authenticated;

SELECT cron.unschedule('rinkd-settle-game-pucks');
SELECT cron.schedule('rinkd-settle-game-pucks', '*/5 * * * *', $$ SELECT public.settle_due_game_pucks(); $$);
