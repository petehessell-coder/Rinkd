-- ============================================================================
-- LRS-1 Phase 4 / Migration L — "tonight's lines" team-feed post (the social
-- payoff). Branch: feature/lineup-roster-subs (stacks on H/I/J/K).
--
-- ⚠️  APPLY POST-PILOT, after Migration H (runbook §4): upsert_lineup_post
--     leans on H's lineup_backing_team_id() and REG E's current_profile_id().
--     The DO block below fails the apply loudly if either is missing.
--
-- What this adds:
--
-- 1. posts.lines_for_game_id — the idempotency key for the auto-post. One
--    "tonight's lines" post per (game, team), enforced by a partial UNIQUE
--    index, exactly the recap_for_game_id pattern. Re-finalizing a lineup
--    UPDATES the existing post (ON CONFLICT below) — never double-posts.
--    Deliberately NO foreign key: the id is polymorphic (league_games or
--    team_games by game_source — tournament games have no team feed), same
--    posture as REG's FK-less registrant_id. A deleted game leaves the post
--    behind as a plain team post, which is the right outcome for a feed.
--
-- 2. upsert_lineup_post() — SECURITY DEFINER, and that needs justifying
--    (default is INVOKER per the May 18 decision): posts UPDATE RLS is
--    author-only, but a team has multiple managers/coaches and a re-finalize
--    by coach B must refresh the post coach A created — a stale lines post
--    is silently wrong data. DEFINER scope is fenced by:
--      • is_team_manager(backing team, caller) — fail closed (42501);
--      • a PARTICIPATION check mirroring Migration H's: the team must
--        actually play in p_game_id, so a manager can't attach lines posts
--        to arbitrary games (post spam / fake-schedule vector);
--      • tag/scoping forced server-side: team_id is always the backing
--        teams.id (the team's own feed), league_id/tournament_id stay NULL —
--        the post can never ride a broader feed surface;
--      • content length-capped; the existing auto-moderation trigger
--        (trg_auto_moderate_posts, BEFORE INSERT OR UPDATE OF content)
--        fires on both paths unchanged.
--
-- Privacy posture (the cluster's non-negotiable, audited Jun 12): the post
-- carries player NAMES exactly as the roster/lineup surfaces already expose
-- them (team_members.invite_name / profiles.name are anon display-granted;
-- game_lineups is anon-readable) — every minor on a lineup got there through
-- Migration H's consent gate. What stays shielded is the minor's stable
-- profiles.id (Migration I posture): the auto-post embeds NO profile ids, no
-- @mentions, no profile links — plain text only. The push (send-lines-alert)
-- is team-level only, no player names on OS surfaces.
-- ============================================================================

-- 0 ── Loud dependency check ─────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.lineup_backing_team_id(text, uuid)') is null then
    raise exception 'LRS-1 Migration L requires Migration H (lineup_backing_team_id). Apply H first (runbook §4).';
  end if;
  if to_regprocedure('public.current_profile_id()') is null then
    raise exception 'LRS-1 Migration L requires REG Migration E (current_profile_id). Apply REG A-G first (runbook §4).';
  end if;
end $$;

-- 1 ── Column + idempotency index ────────────────────────────────────────────
-- Plain ALTER on purpose (Migration J lesson): if a lines_for_game_id ever
-- appears on prod ahead of this file, the apply must FAIL LOUDLY, not skip.
-- Audited against live prod Jun 12 2026: no posts.lines* column, no
-- posts_lines* index, no upsert_lineup_post function exist.
alter table public.posts
  add column lines_for_game_id uuid;

comment on column public.posts.lines_for_game_id is
  'Set on auto-generated "tonight''s lines" posts: the league_games.id or team_games.id (by the lineup''s game_source) the lines belong to. One post per (game, team) via posts_lines_for_game_team_unique_idx. FK-less on purpose — polymorphic game id.';

create unique index posts_lines_for_game_team_unique_idx
  on public.posts (lines_for_game_id, team_id)
  where lines_for_game_id is not null;

-- 2 ── The finalize upsert ───────────────────────────────────────────────────
create function public.upsert_lineup_post(
  p_game_id uuid, p_game_source text, p_team_id uuid, p_content text
) returns public.posts
language plpgsql security definer set search_path = public as $$
declare
  v_caller  uuid;
  v_backing uuid;
  v_post    public.posts;
begin
  if p_game_id is null or p_team_id is null
     or p_game_source is null or p_game_source not in ('league', 'team') then
    -- 'tournament' is rejected here by design: tournament teams are
    -- nameplate-only (no backing teams row → no team feed to post on).
    raise exception 'lines posts need a league or team game with a team feed';
  end if;
  if p_content is null or btrim(p_content) = '' or length(p_content) > 4000 then
    raise exception 'invalid lines post content';
  end if;

  v_caller := public.current_profile_id();
  if v_caller is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  -- p_team_id is the lineup-scope id (league_teams.id for league games,
  -- teams.id for team games) — the same id game_lineups carries. Resolve it
  -- to the real teams.id, which is both the authority anchor and the feed.
  v_backing := public.lineup_backing_team_id(p_game_source, p_team_id);
  if v_backing is null then
    raise exception 'lines posts need a league or team game with a team feed';
  end if;

  if not public.is_team_manager(v_backing, v_caller) then
    raise exception 'only a team manager or coach can post the lines'
      using errcode = '42501';
  end if;

  -- Participation (mirrors Migration H's gate): the team must play in this
  -- game, or any manager could pin lines posts onto arbitrary games.
  if p_game_source = 'league' then
    if not exists (
      select 1 from public.league_games g
      where g.id = p_game_id and p_team_id in (g.home_team_id, g.away_team_id)
    ) then
      raise exception 'lines can only be posted for a game this team plays in';
    end if;
  else
    if not exists (
      select 1 from public.team_games tg
      where tg.id = p_game_id and tg.team_id = p_team_id
    ) then
      raise exception 'lines can only be posted for a game this team plays in';
    end if;
  end if;

  -- One post per (game, team), race-proof: concurrent finalizes land on the
  -- unique index and the loser becomes the content refresh. The UPDATE arm
  -- keeps the ORIGINAL author (recap posture — attribution doesn't shift on
  -- re-finalize) and keeps created_at (no feed re-bump for a line tweak).
  insert into public.posts
    (author_id, content, tag, tag_color, team_id, lines_for_game_id, created_at)
  values
    (v_caller, p_content, 'Lineup', '#22C55E', v_backing, p_game_id, now())
  on conflict (lines_for_game_id, team_id) where lines_for_game_id is not null
  do update set content = excluded.content, tag = 'Lineup', tag_color = '#22C55E'
  returning * into v_post;

  return v_post;
end;
$$;

revoke all on function public.upsert_lineup_post(uuid, text, uuid, text) from public, anon;
grant execute on function public.upsert_lineup_post(uuid, text, uuid, text) to authenticated, service_role;

comment on function public.upsert_lineup_post(uuid, text, uuid, text) is
  'LRS-1 P4: create-or-refresh the "tonight''s lines" post on the backing team''s feed. DEFINER so any current manager/coach can refresh a colleague''s post; fenced by is_team_manager + a participation check.';
