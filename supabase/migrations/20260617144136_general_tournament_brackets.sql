-- BRACKET-GEN-2 — general single-elimination tournament brackets (size 4/8/16).
--
-- External sources (GameSheet/HockeyShift) expose NO bracket topology, so the
-- structure stays native: Rinkd seeds a bracket from the standings it computes
-- off synced games (director confirms once), then the poller fills scores and
-- advances winners. This migration adds the topology columns + a generalized,
-- name-agnostic advancement function.
--
-- Topology (on `games`):
--   bracket_round  1 = first round PLAYED (largest), counting up to the final
--   bracket_slot   0-indexed position within that round
--   bracket_size   N (number of seeds) — carried on every bracket game
-- Advancement: winner of (round r, slot s) -> (round r+1, slot floor(s/2)),
-- HOME if s even, AWAY if s odd. The lone top-round non-consolation game is the
-- final; the 3rd-place game (round='consolation') is fed by the two semi losers.
--
-- Legacy 4-team brackets (generateChampionshipBracket) have bracket_round NULL,
-- so advance_tournament_bracket ignores them and resolve_tournament_bracket
-- keeps handling them — nothing live changes for existing brackets.

-- 1. Topology columns (nullable; NULL for pool games + legacy brackets).
alter table public.games
  add column bracket_round smallint,
  add column bracket_slot  smallint,
  add column bracket_size  smallint;

-- 2. Widen the round label set for deeper single-elim rounds.
alter table public.games drop constraint games_round_check;
alter table public.games add constraint games_round_check
  check (round = any (array['pool','round_of_16','quarterfinal','semifinal','final','consolation']));

-- 3. Generalized advancement. Name-agnostic: propagates winners up the
--    (bracket_round, bracket_slot) tree, fills the 3rd-place game from the two
--    semifinal losers, and reports the final matchup the moment it's fully set
--    (so the caller can post the "Final set" recap once). Idempotent: only fills
--    NULL slots. Shootout-aware. SECURITY DEFINER so the service-role poller and
--    an authed director both advance under the same logic.
create or replace function public.advance_tournament_bracket(p_tournament_id uuid, p_division_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  g record; par record; fin record; s1 record; s2 record;
  win_team uuid; l1 uuid; l2 uuid; w1 text; w2 text;
  total_rounds int; advanced int := 0; final_touched boolean := false;
  out jsonb;
begin
  if p_tournament_id is null then return jsonb_build_object('advanced', 0); end if;

  -- total rounds = deepest non-consolation bracket round (the final's round)
  select max(bracket_round) into total_rounds
    from public.games
   where tournament_id = p_tournament_id
     and bracket_round is not null
     and coalesce(round,'') <> 'consolation'
     and (p_division_id is null or division_id = p_division_id);
  if total_rounds is null then return jsonb_build_object('advanced', 0); end if;

  -- (1) propagate winners up the tree
  for g in
    select * from public.games
     where tournament_id = p_tournament_id
       and bracket_round is not null
       and coalesce(round,'') <> 'consolation'
       and bracket_round < total_rounds
       and status = 'final'
       and (p_division_id is null or division_id = p_division_id)
     order by bracket_round asc, bracket_slot asc
  loop
    win_team := case
      when coalesce(g.home_score,0) > coalesce(g.away_score,0) then g.home_team_id
      when coalesce(g.away_score,0) > coalesce(g.home_score,0) then g.away_team_id
      when g.shootout_winner = 'home' then g.home_team_id
      when g.shootout_winner = 'away' then g.away_team_id
      else null end;
    if win_team is null then continue; end if;  -- tied, no shootout → can't advance yet

    select * into par from public.games
     where tournament_id = p_tournament_id
       and coalesce(round,'') <> 'consolation'
       and bracket_round = g.bracket_round + 1
       and bracket_slot  = (g.bracket_slot / 2)    -- integer division = floor (slots >= 0)
       and (p_division_id is null or division_id = p_division_id)
     limit 1;
    if par.id is null then continue; end if;

    if (g.bracket_slot % 2) = 0 then
      if par.home_team_id is null then
        update public.games set home_team_id = win_team where id = par.id;
        advanced := advanced + 1;
        if par.bracket_round = total_rounds then final_touched := true; end if;
      end if;
    else
      if par.away_team_id is null then
        update public.games set away_team_id = win_team where id = par.id;
        advanced := advanced + 1;
        if par.bracket_round = total_rounds then final_touched := true; end if;
      end if;
    end if;
  end loop;

  -- (2) 3rd-place game: losers of the two semifinals (round = total_rounds - 1)
  if total_rounds >= 2 then
    select * into s1 from public.games
     where tournament_id = p_tournament_id and coalesce(round,'') <> 'consolation'
       and bracket_round = total_rounds - 1 and bracket_slot = 0
       and (p_division_id is null or division_id = p_division_id) limit 1;
    select * into s2 from public.games
     where tournament_id = p_tournament_id and coalesce(round,'') <> 'consolation'
       and bracket_round = total_rounds - 1 and bracket_slot = 1
       and (p_division_id is null or division_id = p_division_id) limit 1;
    if s1.id is not null and s2.id is not null and s1.status='final' and s2.status='final' then
      w1 := case when coalesce(s1.home_score,0) > coalesce(s1.away_score,0) then 'home'
                 when coalesce(s1.away_score,0) > coalesce(s1.home_score,0) then 'away'
                 else s1.shootout_winner end;
      w2 := case when coalesce(s2.home_score,0) > coalesce(s2.away_score,0) then 'home'
                 when coalesce(s2.away_score,0) > coalesce(s2.home_score,0) then 'away'
                 else s2.shootout_winner end;
      if w1 is not null and w2 is not null then
        l1 := case when w1='home' then s1.away_team_id else s1.home_team_id end;
        l2 := case when w2='home' then s2.away_team_id else s2.home_team_id end;
        update public.games
           set home_team_id = coalesce(home_team_id, l1),
               away_team_id = coalesce(away_team_id, l2)
         where tournament_id = p_tournament_id and round = 'consolation'
           and bracket_round = total_rounds
           and (p_division_id is null or division_id = p_division_id)
           and (home_team_id is null or away_team_id is null);
        if found then advanced := advanced + 1; end if;
      end if;
    end if;
  end if;

  -- (3) report the final matchup the turn it becomes fully set (for the recap)
  out := jsonb_build_object('advanced', advanced);
  if final_touched then
    select * into fin from public.games
     where tournament_id = p_tournament_id and coalesce(round,'') <> 'consolation'
       and bracket_round = total_rounds
       and (p_division_id is null or division_id = p_division_id) limit 1;
    if fin.id is not null and fin.home_team_id is not null and fin.away_team_id is not null and fin.status <> 'final' then
      out := out || jsonb_build_object('final_matchup', jsonb_build_object(
        'game_id', fin.id,
        'home', (select team_name from public.tournament_teams where id = fin.home_team_id),
        'away', (select team_name from public.tournament_teams where id = fin.away_team_id)));
    end if;
  end if;
  return out;
end;
$function$;
