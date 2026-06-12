-- ============================================================================
-- GOALIE-1 / Migration M — goalie-in-net attribution
-- Stacked on the LRS cluster: needs H (game_lineups.player_id/line) and the
-- post-I signatures of the goalie RPCs. Apply order: H → I → J → K → L → M.
--
-- WHAT THIS IS: the capture already exists (game_goalie_changes + the
-- ScorerView goalie modal + game_lineups is_goalie/is_starter/line). This
-- migration derives WHO WAS IN NET at each moment and attributes GA/SA/W-L-T/
-- SO per goalie, replacing the n=1-roster-goalie fallback in the two live
-- goalie boards. Plus ONE capture column: game_goals.empty_net.
--
-- CLOCK CONVENTION (pin this): the game clock COUNTS DOWN (20:00 → 0:00), so
-- within a period EARLIER = a HIGHER time_in_period. All ordering goes
-- through game_clock_key(), which maps (period, clock) onto a single
-- ascending "elapsed" key:
--     k = period * 100000 + (99999 - clock_seconds)
--     (NULL/unparseable clock → offset 0 = the very start of the period; all
--      timed events in a period key at offset >= 40000, so a null-clock event
--      always sorts before every timed event of its period.)
-- A future per-game/league count-up override only has to flip the offset to
-- clock_seconds inside game_clock_key — every consumer goes through it.
--
-- BOUNDARY CONVENTION: segments own goals on a half-open interval
-- (open_k, close_k] — a goal at the EXACT instant of a change charges the
-- OUTGOING goalie (the dominant data-entry pattern: goal allowed, goalie
-- yanked, both logged at the same clock time). The empty_net flag is
-- AUTHORITATIVE and overrides the timeline either way: an EN-flagged goal
-- charges no one even if a segment claims a goalie was in net.
-- Period-START lookups (the shots rule) use the opposite boundary
-- [open_k, close_k): a change logged at the start of a period (null clock)
-- hands that period's shots to the INCOMING goalie.
--
-- DOCUMENTED ATTRIBUTION RULES:
--   GA   — precise: empty_net → no one; else the goal's (period, clock) →
--          in-net segment → that goalie. NULL segment (pulled / unknown) →
--          no one. A goal with NO parseable clock is charged only when
--          exactly one distinct goalie's segments overlap its period;
--          otherwise no one ("never mis-attribute").
--   SA   — period granularity (game_shots is a per-period aggregate): the
--          full period's shots go to the goalie in net at PERIOD START.
--          Exact for whole-period/whole-game goalies; coarse-but-documented
--          for mid-period swaps.
--   W/L/T — goalie of record: the goalie in net when the game-deciding goal
--          was scored (winner's (loser_score+1)-th goal in clock order); if
--          that can't be located (hand-edited score, SO decision, ambiguous
--          clock) → the goalie who FINISHED the game. Exactly one goalie per
--          team per game carries the result — no double-credit. OT/SO losses
--          stay folded into L/T exactly as the team-level logic before this
--          migration (no OTL column; signatures are frozen).
--   SO   — only a goalie who was the SOLE goalie to play the game, with team
--          GA = 0 by BOTH the board's GA semantics and the official score
--          (a hand-edited score with no goal rows must not mint a shutout in
--          a loss; a genuine 0-0 SO loss still earns it). A shared 0-GA game
--          credits NO ONE (standard convention). An EN pull-and-return by
--          the same goalie does NOT void it.
--   GP   — a goalie played a game when they own a segment with real extent
--          inside the game (a pre-game-only or zero-length segment is not
--          ice time).
--
-- TRIVIAL-GAME PARITY: when a game resolves to a single goalie, the league
-- board still charges them the team's score-based GA (minus EN/no-goalie
-- rows) and the tournament board the row-count GA — exactly each board's
-- pre-M semantics, so existing single-goalie numbers don't move. Only games
-- with a real split use per-segment row attribution (a hand-edited score
-- without goal rows can then under-count attributed GA — accepted and
-- preferred over inventing attribution).
--
-- TEAM-LEVEL FALLBACK: a game whose timeline resolves to NO goalie rolls into
-- the team's "<Team> (goaltending)" residual row (jersey/player_id NULL) —
-- per GAME, not per team, so known games still get individual lines.
--
-- game_source TOLERANCE: the GS-1 write path (queuedWrite + the sync edge fn
-- replay) leaves game_source NULL — rows already exist on prod. Every event
-- read here is scoped by game_id against the parent games table, so we accept
-- (game_source IS NULL OR game_source = expected) instead of silently
-- dropping those rows the way the hard '=' filters do. (Companion client/edge
-- changes in this build start stamping game_source again.)
--
-- RETURN SIGNATURES ARE FROZEN: both RPCs keep Migration I's exact column
-- list (incl. additive player_id) — live boards, additive only. player_id
-- resolves per game via the lineup (identity-keyed, K's pattern: a sub goalie
-- accrues to their own row on whatever team they subbed for; jersey
-- collisions resolve per team), then the season roster, and stays shielded
-- for minors via shield_minor_player_id.
--
-- Audited against prod Jun 12 2026: parse_game_clock / game_clock_key /
-- goalie_in_net_timeline / goalie_game_lines do not exist anywhere; no table
-- has an empty_net column. All 287 timed prod goals match '^m{1,3}:ss$'.
-- ============================================================================

-- 0 ── empty_net: the authoritative "no goalie charged" capture flag ─────────
alter table public.game_goals
  add column empty_net boolean not null default false;

comment on column public.game_goals.empty_net is
  'Goal was scored into an empty net (defending goalie pulled / none dressed). '
  'AUTHORITATIVE no-goalie-charged signal for goalie stats — the timeline''s '
  'pulled-goalie (NULL) segment is only the backstop when the flag was missed.';

-- 1 ── parse_game_clock: "mm:ss" → seconds, NULL on anything else ────────────
create function public.parse_game_clock(p_clock text)
returns integer
language sql immutable
set search_path = public
as $$
  select case
    when trim(p_clock) ~ '^\d{1,3}:[0-5]?\d$'
    then split_part(trim(p_clock), ':', 1)::integer * 60
       + split_part(trim(p_clock), ':', 2)::integer
  end;
$$;

comment on function public.parse_game_clock(text) is
  'Strict mm:ss game-clock parser (matches every timed prod row). Garbage/NULL → NULL.';

revoke all on function public.parse_game_clock(text) from public;
grant execute on function public.parse_game_clock(text) to anon, authenticated, service_role;

-- 2 ── game_clock_key: (period, count-DOWN clock) → ascending elapsed key ────
-- Earlier in a period = HIGHER clock = SMALLER key. NULL clock = period start.
-- The single place a count-up override would ever be wired in.
create function public.game_clock_key(p_period integer, p_clock text)
returns bigint
language sql immutable
set search_path = public
as $$
  select case
    when p_period is null then null
    else p_period::bigint * 100000
       + coalesce(99999 - least(public.parse_game_clock(p_clock), 99999), 0)
  end;
$$;

comment on function public.game_clock_key(integer, text) is
  'Orders count-down-clock game events: period asc, time_in_period DESC. '
  'k = period*100000 + (99999 - seconds); null clock keys at period start.';

revoke all on function public.game_clock_key(integer, text) from public;
grant execute on function public.game_clock_key(integer, text) to anon, authenticated, service_role;

-- 3 ── goalie_in_net_timeline: ordered in-net segments for one (game, team) ──
-- Segment 0 opens with the starting goalie, resolved in order:
--   1. the unique dressed goalie with line = 1 (LineupModal''s explicit pick)
--   2. the unique dressed goalie with is_starter (the pick flips others false;
--      with no pick EVERY goalie defaults true, so uniqueness is the signal)
--   3. the only dressed goalie
--   4. the first change''s goalie_out_number — game-recorded truth. (NOT
--      goalie_in: crediting the incoming goalie for goals scored before they
--      entered would mis-attribute; out-of-net truth never does.)
--   5. league only: the unique season-roster goalie — skipped if any change
--      brought that jersey IN (then they demonstrably did not start)
--   6. NULL — unknown; events before the first change charge no one.
-- Each change closes the current segment and opens a new one with
-- goalie_in_number (NULL = pulled / empty net). goalie_number NULL = no
-- goalie charged for events in that segment.
create function public.goalie_in_net_timeline(
  p_game_id uuid, p_game_source text, p_team_id uuid
)
returns table(
  segment_index integer,
  from_period integer,
  from_clock   text,
  to_period    integer,
  to_clock     text,
  open_k       bigint,
  close_k      bigint,
  goalie_number integer
)
language sql stable
set search_path = public
as $$
  with changes as (
    select c.goalie_out_number, c.goalie_in_number, c.period, c.time_in_period,
           public.game_clock_key(c.period, c.time_in_period) as k,
           c.created_at, c.id
    from public.game_goalie_changes c
    where c.game_id = p_game_id and c.team_id = p_team_id
      and (c.game_source is null or c.game_source = p_game_source)
  ),
  lineup_g as (
    select gl.jersey_number,
           coalesce(gl.line, 0) as line,
           coalesce(gl.is_starter, true) as is_starter
    from public.game_lineups gl
    where gl.game_id = p_game_id and gl.team_id = p_team_id
      and (gl.game_source is null or gl.game_source = p_game_source)
      and coalesce(gl.is_goalie, false)
      and gl.jersey_number is not null
  ),
  starter as (
    select coalesce(
      (select min(jersey_number) from lineup_g where line = 1
         having count(distinct jersey_number) = 1),
      (select min(jersey_number) from lineup_g where is_starter
         having count(distinct jersey_number) = 1),
      (select min(jersey_number) from lineup_g
         having count(distinct jersey_number) = 1),
      (select c.goalie_out_number from changes c
         order by c.k, c.created_at, c.id limit 1),
      (select rj.jersey from (
         select min(tm.jersey_number) as jersey
         from public.league_teams lt
         join public.team_members tm
           on tm.team_id = lt.team_id
          and tm.position = 'Goalie'
          and tm.jersey_number is not null
         where p_game_source = 'league' and lt.id = p_team_id
         having count(distinct tm.jersey_number) = 1
       ) rj
       where not exists (select 1 from changes c where c.goalie_in_number = rj.jersey))
    ) as jersey
  ),
  events as (
    select 0 as ord, 0::bigint as k,
           null::integer as ev_period, null::text as ev_clock,
           (select jersey from starter) as goalie
    union all
    select row_number() over (order by k, created_at, id)::integer,
           k, period, time_in_period, goalie_in_number
    from changes
  )
  select ord            as segment_index,
         ev_period      as from_period,
         ev_clock       as from_clock,
         lead(ev_period) over w as to_period,
         lead(ev_clock)  over w as to_clock,
         k              as open_k,
         lead(k) over w as close_k,
         goalie         as goalie_number
  from events
  window w as (order by ord)
  order by ord;
$$;

comment on function public.goalie_in_net_timeline(uuid, text, uuid) is
  'Ordered goalie-in-net segments for one (game, team) from the starting '
  'goalie + game_goalie_changes. goalie_number NULL = empty net / unknown — '
  'no goalie charged. Goals attach on (open_k, close_k]: a goal at the exact '
  'change instant charges the OUTGOING goalie. close_k NULL = end of game.';

revoke all on function public.goalie_in_net_timeline(uuid, text, uuid) from public;
grant execute on function public.goalie_in_net_timeline(uuid, text, uuid) to anon, authenticated, service_role;

-- 4 ── goalie_game_lines: one team-game → per-goalie stat lines ──────────────
-- The shared attribution engine both boards consume via LATERAL. Emits one
-- row per goalie who PLAYED (real in-game extent), or a single
-- goalie_number-NULL residual row when the timeline is unknown (n = 0).
--   p_team_score / p_opp_score — the caller''s official score (deciding-goal
--     index + result are computed from these, never from row counts).
--   p_result — the caller''s own team-level W/L/T (league: score-only;
--     tournament: score + shootout_winner) so team totals stay byte-identical.
--   p_ga_total — the caller''s own GA semantics (league: opp score;
--     tournament: goal-row count) for single-goalie parity.
create function public.goalie_game_lines(
  p_game_id uuid, p_game_source text,
  p_team_id uuid, p_opp_team_id uuid,
  p_team_score integer, p_opp_score integer,
  p_result text, p_ga_total integer
)
returns table(
  goalie_number integer,   -- NULL = team-level residual (unknown timeline)
  ga integer, sa integer,
  win integer, loss integer, tie integer, shutout integer
)
language sql stable
set search_path = public
as $$
  with tl as (
    select * from public.goalie_in_net_timeline(p_game_id, p_game_source, p_team_id)
  ),
  -- segments with real extent INSIDE the game (period 1 starts at key 100000):
  -- pre-game-only and zero-length segments are not ice time.
  played as (
    select * from tl
    where goalie_number is not null
      and coalesce(close_k, 9223372036854775807) > greatest(open_k, 100000)
  ),
  n_goalies as (
    select count(distinct goalie_number)::integer as n from played
  ),
  goals_against as (
    select gg.id, gg.empty_net, gg.period,
           public.parse_game_clock(gg.time_in_period) as clock,
           public.game_clock_key(gg.period, gg.time_in_period) as k
    from public.game_goals gg
    where gg.game_id = p_game_id and gg.team_id = p_opp_team_id
      and (gg.game_source is null or gg.game_source = p_game_source)
      and coalesce(gg.is_shootout, false) = false
  ),
  charged as (
    select g.id,
      case
        when g.empty_net then null            -- the flag is authoritative
        when g.clock is not null then
          (select t.goalie_number from tl t
            where g.k > t.open_k
              and g.k <= coalesce(t.close_k, 9223372036854775807)
            order by t.segment_index limit 1)
        else
          -- no parseable clock: charge only when exactly one distinct goalie
          -- overlaps the goal's period — otherwise no one.
          (select min(t.goalie_number) from played t
            where t.open_k < (g.period + 1)::bigint * 100000
              and coalesce(t.close_k, 9223372036854775807) > g.period::bigint * 100000
            having count(distinct t.goalie_number) = 1)
      end as goalie_number
    from goals_against g
  ),
  shots as (
    select gs.period, sum(gs.count)::integer as cnt
    from public.game_shots gs
    where gs.game_id = p_game_id and gs.team_id = p_opp_team_id
      and (gs.game_source is null or gs.game_source = p_game_source)
    group by gs.period
  ),
  -- period-start boundary is [open, close): a change AT period start hands
  -- the period's shots to the INCOMING goalie.
  shot_owner as (
    select s.cnt,
      (select t.goalie_number from tl t
        where t.open_k <= s.period::bigint * 100000
          and coalesce(t.close_k, 9223372036854775807) > s.period::bigint * 100000
        order by t.segment_index limit 1) as goalie_number
    from shots s
  ),
  -- the game-deciding goal: the winner's (loser_score+1)-th goal in clock
  -- order. Only resolvable for regulation-decided results.
  deciding as (
    select g.k, g.period, g.clock
    from (
      select public.parse_game_clock(gg.time_in_period) as clock,
             public.game_clock_key(gg.period, gg.time_in_period) as k,
             gg.period,
             row_number() over (
               order by public.game_clock_key(gg.period, gg.time_in_period),
                        gg.created_at, gg.id
             ) as rn
      from public.game_goals gg
      where gg.game_id = p_game_id
        and gg.team_id = case when p_result = 'W' then p_team_id else p_opp_team_id end
        and (gg.game_source is null or gg.game_source = p_game_source)
        and coalesce(gg.is_shootout, false) = false
    ) g
    where p_result in ('W', 'L')
      and coalesce(p_team_score, 0) <> coalesce(p_opp_score, 0)
      and g.rn = case when p_result = 'W'
                      then coalesce(p_opp_score, 0) + 1
                      else coalesce(p_team_score, 0) + 1 end
  ),
  finisher as (
    select goalie_number from played
    order by open_k desc, segment_index desc
    limit 1
  ),
  record_goalie as (
    select coalesce(
      (select case
          when d.clock is not null then
            (select t.goalie_number from tl t
              where d.k > t.open_k
                and d.k <= coalesce(t.close_k, 9223372036854775807)
              order by t.segment_index limit 1)
          else
            (select min(t.goalie_number) from played t
              where t.open_k < (d.period + 1)::bigint * 100000
                and coalesce(t.close_k, 9223372036854775807) > d.period::bigint * 100000
              having count(distinct t.goalie_number) = 1)
        end
       from deciding d),
      (select goalie_number from finisher)
    ) as goalie_number
  )
  select
    pg.goalie_number,
    case when (select n from n_goalies) = 1
      -- single-goalie parity: the caller's GA total minus rows charged to no
      -- one (EN-flagged / pulled-net / unattributable)
      then greatest(0, coalesce(p_ga_total, 0)
                       - (select count(*) from charged c where c.goalie_number is null))::integer
      else coalesce((select count(*) from charged c
                      where c.goalie_number = pg.goalie_number), 0)::integer
    end as ga,
    coalesce((select sum(so2.cnt) from shot_owner so2
               where so2.goalie_number = pg.goalie_number), 0)::integer as sa,
    case when p_result = 'W' and pg.goalie_number = (select goalie_number from record_goalie) then 1 else 0 end as win,
    case when p_result = 'L' and pg.goalie_number = (select goalie_number from record_goalie) then 1 else 0 end as loss,
    case when p_result = 'T' and pg.goalie_number = (select goalie_number from record_goalie) then 1 else 0 end as tie,
    -- SO needs zero GA by BOTH the caller's semantics and the official score:
    -- a hand-edited score without goal rows must not mint a shutout in a
    -- regulation loss. (A genuine 0-0 SO loss still earns it.)
    case when (select n from n_goalies) = 1
           and coalesce(p_ga_total, 0) = 0
           and coalesce(p_opp_score, 0) = 0 then 1 else 0 end as shutout
  from (select distinct p2.goalie_number from played p2) pg
  union all
  -- unknown timeline → one team-level residual line carrying the whole game
  select null::integer,
         coalesce(p_ga_total, 0),
         coalesce((select sum(cnt) from shots), 0)::integer,
         case when p_result = 'W' then 1 else 0 end,
         case when p_result = 'L' then 1 else 0 end,
         case when p_result = 'T' then 1 else 0 end,
         case when coalesce(p_ga_total, 0) = 0 and coalesce(p_opp_score, 0) = 0 then 1 else 0 end
  where (select n from n_goalies) = 0;
$$;

comment on function public.goalie_game_lines(uuid, text, uuid, uuid, integer, integer, text, integer) is
  'Per-goalie stat lines for one (game, team) via goalie_in_net_timeline. '
  'GA precise (empty_net charges no one), SA at period-start granularity, '
  'W/L/T to the goalie of record, SO only for a sole-goalie 0-GA game. '
  'goalie_number NULL = team residual when the timeline is unknown.';

revoke all on function public.goalie_game_lines(uuid, text, uuid, uuid, integer, integer, text, integer) from public;
grant execute on function public.goalie_game_lines(uuid, text, uuid, uuid, integer, integer, text, integer) to anon, authenticated, service_role;

-- 5 ── get_league_goalie_stats: timeline-attributed, identity-keyed ──────────
-- Signature frozen at Migration I's (additive player_id at the end).
-- Team-level W/L/T/GA semantics unchanged (score-only, SO/OT folded as
-- before); only the attribution within each team changed.
drop function if exists public.get_league_goalie_stats(uuid);
create function public.get_league_goalie_stats(p_league_id uuid)
 returns table(team_id uuid, team_name text, jersey_number integer, goalie_name text, gp integer, shots_against integer, goals_against integer, save_pct numeric, gaa numeric, wins integer, losses integer, ties integer, shutouts integer, player_id uuid)
 language sql
 stable
 set search_path to 'public'
as $function$
  with lf as (
    select lg.id as game_id, lg.home_team_id as lt_id, lg.away_team_id as opp_id,
           coalesce(lg.home_score, 0) as gf, coalesce(lg.away_score, 0) as ga
    from public.league_games lg
    where lg.league_id = p_league_id and lg.status = 'final'
      and lg.home_team_id is not null and lg.away_team_id is not null
    union all
    select lg.id, lg.away_team_id, lg.home_team_id,
           coalesce(lg.away_score, 0), coalesce(lg.home_score, 0)
    from public.league_games lg
    where lg.league_id = p_league_id and lg.status = 'final'
      and lg.home_team_id is not null and lg.away_team_id is not null
  ),
  lines as (
    select lf.lt_id, lf.game_id,
           gl.goalie_number, gl.ga, gl.sa, gl.win, gl.loss, gl.tie, gl.shutout
    from lf
    cross join lateral public.goalie_game_lines(
      lf.game_id, 'league', lf.lt_id, lf.opp_id,
      lf.gf, lf.ga,
      case when lf.gf > lf.ga then 'W' when lf.gf < lf.ga then 'L' else 'T' end,
      lf.ga
    ) gl
  ),
  -- (game, team, jersey) → the ONE identity who wore it that night (K's rule:
  -- two identities on one jersey in one game = data error, fail to roster).
  lineup_ident as (
    select gl.game_id, gl.team_id, gl.jersey_number as jersey,
           min(coalesce(gl.player_id, gl.user_id)::text)::uuid as identity
    from public.game_lineups gl
    join public.league_games lg on lg.id = gl.game_id and lg.league_id = p_league_id
    where (gl.game_source is null or gl.game_source = 'league')
      and gl.jersey_number is not null
      and coalesce(gl.player_id, gl.user_id) is not null
    group by gl.game_id, gl.team_id, gl.jersey_number
    having count(distinct coalesce(gl.player_id, gl.user_id)) = 1
  ),
  -- season roster, jersey-keyed (sub pools never seed attribution): ANY
  -- position on purpose — an emergency goalie is a rostered skater in net.
  roster as (
    select distinct on (lt.id, tm.jersey_number)
      lt.id as lt_id, tm.jersey_number as jersey,
      coalesce(nullif(trim(tm.invite_name), ''), pr.name, pr.handle) as player_name,
      tm.user_id as identity
    from public.league_teams lt
    join public.team_members tm on tm.team_id = lt.team_id and tm.jersey_number is not null
    left join public.profiles pr on pr.id = tm.user_id
    where lt.league_id = p_league_id and coalesce(lt.is_sub_pool, false) = false
    order by lt.id, tm.jersey_number,
      (coalesce(nullif(trim(tm.invite_name), ''), pr.name, pr.handle) is not null) desc,
      tm.user_id
  ),
  attributed as (
    select l.lt_id, l.game_id, l.goalie_number as jersey,
           l.ga, l.sa, l.win, l.loss, l.tie, l.shutout,
           case when l.goalie_number is null then null
                else coalesce(li.identity, r.identity) end as identity
    from lines l
    left join lineup_ident li
      on l.goalie_number is not null
     and li.game_id = l.game_id and li.team_id = l.lt_id and li.jersey = l.goalie_number
    left join roster r
      on l.goalie_number is not null
     and r.lt_id = l.lt_id and r.jersey = l.goalie_number
  ),
  agg as (
    select lt_id, identity,
           -- jersey-keyed ghost when identity unknown; (NULL, NULL) = the
           -- team residual bucket (games with an unknown timeline)
           case when identity is null then jersey end as ghost_jersey,
           max(jersey) as last_jersey,
           count(*)::integer as gp,
           sum(ga)::integer as ga, sum(sa)::integer as sa,
           sum(win)::integer as wins, sum(loss)::integer as losses,
           sum(tie)::integer as ties, sum(shutout)::integer as shutouts
    from attributed
    group by lt_id, identity, case when identity is null then jersey end
  )
  select
    a.lt_id as team_id,
    coalesce(t.name, lt.team_name) as team_name,
    a.last_jersey as jersey_number,
    case
      when a.identity is not null then coalesce(pr.name, pr.handle, rg.player_name, '#' || a.last_jersey)
      when a.ghost_jersey is not null then coalesce(rg.player_name, '#' || a.ghost_jersey)
      else coalesce(t.name, lt.team_name) || ' (goaltending)'
    end as goalie_name,
    a.gp,
    a.sa as shots_against,
    a.ga as goals_against,
    round((a.sa - a.ga)::numeric / nullif(a.sa, 0), 3) as save_pct,
    round(a.ga::numeric / nullif(a.gp, 0), 2) as gaa,
    a.wins, a.losses, a.ties, a.shutouts,
    public.shield_minor_player_id(a.identity) as player_id
  from agg a
  join public.league_teams lt on lt.id = a.lt_id
  left join public.teams t on t.id = lt.team_id
  left join public.profiles pr on pr.id = a.identity
  left join roster rg on rg.lt_id = a.lt_id and rg.jersey = a.last_jersey
  order by gaa asc nulls last;
$function$;
grant execute on function public.get_league_goalie_stats(uuid) to anon, authenticated, service_role;

-- 6 ── get_tournament_goalie_stats: timeline-attributed, identity-keyed ──────
-- Signature frozen at Migration I's. Team-level result semantics unchanged
-- (score, then shootout_winner 'home'/'away'); GA stays goal-row-based.
-- NEW relative to I: games whose timeline is unknown now contribute a
-- "<Team> (goaltending)" residual row instead of silently dropping out.
drop function if exists public.get_tournament_goalie_stats(uuid, uuid);
create function public.get_tournament_goalie_stats(p_tournament_id uuid, p_division_id uuid default null::uuid)
 returns table(team_id uuid, team_name text, jersey_number integer, goalie_name text, gp integer, shots_against integer, goals_against integer, save_pct numeric, gaa numeric, wins integer, losses integer, ties integer, shutouts integer, player_id uuid)
 language sql
 stable
 set search_path to 'public'
as $function$
  with tgames as (
    select id from public.games
    where tournament_id = p_tournament_id
      and (p_division_id is null or division_id = p_division_id)
  ),
  tf as (
    select g.id as game_id, g.home_team_id as tt_id, g.away_team_id as opp_id,
           coalesce(g.home_score, 0) as gf, coalesce(g.away_score, 0) as ga,
           case
             when coalesce(g.home_score, 0) > coalesce(g.away_score, 0) then 'W'
             when coalesce(g.home_score, 0) < coalesce(g.away_score, 0) then 'L'
             when g.shootout_winner = 'home' then 'W'
             when g.shootout_winner = 'away' then 'L'
             else 'T'
           end as result
    from public.games g
    where g.tournament_id = p_tournament_id and g.status = 'final'
      and (p_division_id is null or g.division_id = p_division_id)
      and g.home_team_id is not null and g.away_team_id is not null
    union all
    select g.id, g.away_team_id, g.home_team_id,
           coalesce(g.away_score, 0), coalesce(g.home_score, 0),
           case
             when coalesce(g.away_score, 0) > coalesce(g.home_score, 0) then 'W'
             when coalesce(g.away_score, 0) < coalesce(g.home_score, 0) then 'L'
             when g.shootout_winner = 'away' then 'W'
             when g.shootout_winner = 'home' then 'L'
             else 'T'
           end
    from public.games g
    where g.tournament_id = p_tournament_id and g.status = 'final'
      and (p_division_id is null or g.division_id = p_division_id)
      and g.home_team_id is not null and g.away_team_id is not null
  ),
  lines as (
    select tf.tt_id, tf.game_id,
           gl.goalie_number, gl.ga, gl.sa, gl.win, gl.loss, gl.tie, gl.shutout
    from tf
    cross join lateral public.goalie_game_lines(
      tf.game_id, 'tournament', tf.tt_id, tf.opp_id,
      tf.gf, tf.ga, tf.result,
      -- tournament GA semantics: non-shootout goal-row count (pre-M parity)
      (select count(*)::integer from public.game_goals gg
        where gg.game_id = tf.game_id and gg.team_id = tf.opp_id
          and (gg.game_source is null or gg.game_source = 'tournament')
          and coalesce(gg.is_shootout, false) = false)
    ) gl
  ),
  lineup_ident as (
    select gl.game_id, gl.team_id, gl.jersey_number as jersey,
           min(coalesce(gl.player_id, gl.user_id)::text)::uuid as identity
    from public.game_lineups gl
    join tgames on tgames.id = gl.game_id
    where (gl.game_source is null or gl.game_source = 'tournament')
      and gl.jersey_number is not null
      and coalesce(gl.player_id, gl.user_id) is not null
    group by gl.game_id, gl.team_id, gl.jersey_number
    having count(distinct coalesce(gl.player_id, gl.user_id)) = 1
  ),
  -- tournaments have no season roster: the lineups ARE the roster. Name +
  -- identity fallback per (team, jersey) across the event's games.
  names as (
    select distinct on (gl.team_id, gl.jersey_number)
      gl.team_id, gl.jersey_number as jersey,
      coalesce(nullif(trim(gl.invite_name), ''), pr.name, pr.handle) as player_name,
      coalesce(gl.player_id, gl.user_id) as identity
    from public.game_lineups gl
    join tgames on tgames.id = gl.game_id
    left join public.profiles pr on pr.id = coalesce(gl.player_id, gl.user_id)
    where (gl.game_source is null or gl.game_source = 'tournament')
      and gl.jersey_number is not null
    order by gl.team_id, gl.jersey_number,
      (coalesce(nullif(trim(gl.invite_name), ''), pr.name, pr.handle) is not null) desc,
      (coalesce(gl.player_id, gl.user_id) is not null) desc,
      gl.created_at desc, gl.id
  ),
  attributed as (
    select l.tt_id, l.game_id, l.goalie_number as jersey,
           l.ga, l.sa, l.win, l.loss, l.tie, l.shutout,
           case when l.goalie_number is null then null
                else coalesce(li.identity, nm.identity) end as identity
    from lines l
    left join lineup_ident li
      on l.goalie_number is not null
     and li.game_id = l.game_id and li.team_id = l.tt_id and li.jersey = l.goalie_number
    left join names nm
      on l.goalie_number is not null
     and nm.team_id = l.tt_id and nm.jersey = l.goalie_number
  ),
  agg as (
    select tt_id, identity,
           case when identity is null then jersey end as ghost_jersey,
           max(jersey) as last_jersey,
           count(*)::integer as gp,
           sum(ga)::integer as ga, sum(sa)::integer as sa,
           sum(win)::integer as wins, sum(loss)::integer as losses,
           sum(tie)::integer as ties, sum(shutout)::integer as shutouts
    from attributed
    group by tt_id, identity, case when identity is null then jersey end
  )
  select
    a.tt_id as team_id,
    tt.team_name,
    a.last_jersey as jersey_number,
    case
      when a.identity is not null then coalesce(pr.name, pr.handle, nm.player_name, '#' || a.last_jersey)
      when a.ghost_jersey is not null then coalesce(nm.player_name, '#' || a.ghost_jersey)
      else tt.team_name || ' (goaltending)'
    end as goalie_name,
    a.gp,
    a.sa as shots_against,
    a.ga as goals_against,
    round((a.sa - a.ga)::numeric / nullif(a.sa, 0), 3) as save_pct,
    round(a.ga::numeric / nullif(a.gp, 0), 2) as gaa,
    a.wins, a.losses, a.ties, a.shutouts,
    public.shield_minor_player_id(a.identity) as player_id
  from agg a
  join public.tournament_teams tt on tt.id = a.tt_id
  left join public.profiles pr on pr.id = a.identity
  left join names nm on nm.team_id = a.tt_id and nm.jersey = a.last_jersey
  order by gaa asc nulls last, save_pct desc;
$function$;
grant execute on function public.get_tournament_goalie_stats(uuid, uuid) to anon, authenticated, service_role;
