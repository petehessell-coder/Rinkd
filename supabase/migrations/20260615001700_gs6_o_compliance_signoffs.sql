-- ============================================================================
-- GS-6 Migration O — USA Hockey compliance: sign-offs + compliant-mode + header
-- Branch: feature/gs-6-compliance (stacks on the LRS cluster + GOALIE-1)
--
-- Makes the Rinkd scoresheet a fully USA Hockey-compliant official record
-- (Rule 505 + Off-Ice Officiating Manual). ALL ADDITIVE — every existing
-- lineup / scoring / scoresheet path renders byte-identical until a context
-- opts into compliant mode. apply_migration runs transactionally, so a syntax
-- error rolls back clean (no half-applied state).
--
-- Design decisions (verified against prod Jun 13 2026):
--   * Coaches are NOT modeled as a team role yet (team_members.role is only
--     player/goalie/manager). So coach identity + CEP + signature are captured
--     AT SIGN-OFF TIME on game_signoffs — the GameSheet model, where coaches
--     sign on the scorer's device. No coach-staff system needed to be compliant.
--   * The DEVICE OPERATOR (assigned scorekeeper / director / commissioner) is
--     the authorized writer; the COACH/OFFICIAL is identified by printed_name +
--     signature, exactly as on paper. So no coach needs a Rinkd account.
--   * Compliance is a per-context MODE — roller/adult/Hockey-Canada contexts
--     stay on the light flow (usah_compliant_scoresheet defaults false).
--   * Sign-offs are immutable (no UPDATE/DELETE path): a correction is a NEW
--     sign-off after a director/commissioner reopen, mirroring USA Hockey
--     "no changes after officials sign."
--
-- What this migration does NOT do (handled in the frontend / a follow-up):
--   * It does not rewrite verify_game_rosters (GS-5) — coach sign-off is a NEW,
--     separate path, so the security-critical suspension RPC is untouched.
--   * It does not move signatures off the generated PDF — signature_path is an
--     optional pointer; the legal mark still rides the PDF as today.
-- ============================================================================

-- 1 ── Compliant-mode toggle + header compliance fields (per context) ─────────
-- These are season-setup values (set once by the operator), NEVER asked of the
-- game-day volunteer — that's the stupid-proof mandate in the schema.
alter table public.leagues
  add column if not exists usah_compliant_scoresheet boolean not null default false,
  add column if not exists usah_association_name text,
  add column if not exists usah_classification text,
  add column if not exists division_label text;

alter table public.tournaments
  add column if not exists usah_compliant_scoresheet boolean not null default false,
  add column if not exists usah_association_name text,
  add column if not exists usah_classification text,
  add column if not exists division_label text;

-- Classification is the USA Hockey level-of-play box on the sheet. Constrained
-- but nullable (non-USAH contexts leave it empty). Drop-then-add so a re-apply
-- is clean.
do $$
begin
  alter table public.leagues drop constraint if exists leagues_usah_classification_chk;
  alter table public.tournaments drop constraint if exists tournaments_usah_classification_chk;
exception when undefined_object then null;
end $$;
alter table public.leagues add constraint leagues_usah_classification_chk
  check (usah_classification is null or usah_classification in
    ('tier1','tier2','girls_women','high_school','house_rec','adult'));
alter table public.tournaments add constraint tournaments_usah_classification_chk
  check (usah_classification is null or usah_classification in
    ('tier1','tier2','girls_women','high_school','house_rec','adult'));

comment on column public.leagues.usah_compliant_scoresheet is
  'GS-6: when true, this league produces a full USA Hockey-compliant official scoresheet (coach pre-game signatures + referee signature enforced). Default false keeps the light flow for roller/adult/non-USAH contexts.';

-- 2 ── Game-level times (Start exists as start_time; add End + Curfew) ────────
alter table public.games        add column if not exists end_time timestamptz;
alter table public.games        add column if not exists curfew_time timestamptz;
alter table public.league_games add column if not exists end_time timestamptz;
alter table public.league_games add column if not exists curfew_time timestamptz;

-- 3 ── Roster present/absent (the only required roster bit USAH adds) ─────────
-- 'dressed' = on the sheet; the rest print struck-through (absent players are
-- crossed out, not deleted). Starting-lineup status stays optional via the
-- existing game_lineups.is_starter — USA Hockey does NOT require a starting
-- lineup, so we don't gate on it.
alter table public.game_lineups
  add column if not exists roster_status text not null default 'dressed';
do $$
begin
  alter table public.game_lineups drop constraint if exists game_lineups_roster_status_chk;
exception when undefined_object then null;
end $$;
alter table public.game_lineups add constraint game_lineups_roster_status_chk
  check (roster_status in ('dressed','scratched','injured','suspended'));

-- 4 ── GM / Match written statement (officials' note, ties into GS-2) ─────────
alter table public.game_suspensions
  add column if not exists official_statement text;
comment on column public.game_suspensions.official_statement is
  'GS-6: the on-ice officials'' brief written statement for a Game Misconduct / Match penalty, printed on the back of the compliant scoresheet (USAH off-ice manual).';

-- 5 ── game_signoffs — structured, auditable, immutable signatures ────────────
create table if not exists public.game_signoffs (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null,
  game_source text not null check (game_source in ('league','tournament')),
  -- who is signing and when in the game lifecycle
  role text not null check (role in
    ('home_coach','visiting_coach','official_scorer','referee','linesperson')),
  phase text not null check (phase in ('pre_game','post_game')),
  -- which team this coach signed for (NULL for officials)
  team_id uuid,
  -- the COACH/OFFICIAL identity is printed_name + signature (paper-equivalent);
  -- signer_profile_id stays NULL unless the signer happens to have an account.
  signer_profile_id uuid references public.profiles(id) on delete set null,
  printed_name text not null,
  -- optional pointer to the signature image (storage path or data URL). The
  -- legal mark also rides the generated PDF, so this can be NULL.
  signature_path text,
  -- coach + on-ice-official certification (USAH Rule 505 / 502)
  cep_number text,
  cep_level text,
  cep_year text,
  official_designation text check (official_designation in ('R','L')),
  is_head_coach boolean not null default false,
  signed_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null  -- device operator (audit)
);

create index if not exists game_signoffs_game_idx
  on public.game_signoffs (game_id, game_source);

comment on table public.game_signoffs is
  'GS-6: structured, auditable pre/post-game sign-offs. Coaches certify the roster pre-game; officials certify the sheet post-game. Immutable — a correction is a new row after a director/commissioner reopen.';

-- RLS: readable by signed-in users (the scoresheet PDF is built client-side by
-- staff/managers). NO insert/update/delete policy — the SECURITY DEFINER RPC
-- below is the only write path (service_role bypasses RLS for the offline-queue
-- replay), which also makes rows effectively immutable to clients.
alter table public.game_signoffs enable row level security;
do $$
begin
  drop policy if exists game_signoffs_read on public.game_signoffs;
exception when undefined_object then null;
end $$;
create policy game_signoffs_read on public.game_signoffs
  for select to authenticated using (true);

-- 6 ── record_game_signoff() — the only write path ───────────────────────────
-- Authorizes the DEVICE OPERATOR as game staff (same set that can score the
-- game), then records the coach/official's signature as data. Conflicts are
-- not computed here (that's GS-5's verify_game_rosters job, unchanged) — this
-- is the signature capture, separate and additive.
create or replace function public.record_game_signoff(
  p_game_id uuid,
  p_game_source text,
  p_role text,
  p_phase text,
  p_team_id uuid default null,
  p_printed_name text default null,
  p_signature_path text default null,
  p_cep_number text default null,
  p_cep_level text default null,
  p_cep_year text default null,
  p_official_designation text default null,
  p_is_head_coach boolean default false
) returns public.game_signoffs
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
  v_home uuid;
  v_away uuid;
  v_is_staff boolean := false;
  v_row public.game_signoffs;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if p_printed_name is null or btrim(p_printed_name) = '' then
    raise exception 'a printed name is required to sign';
  end if;
  if p_game_source not in ('league','tournament') then
    raise exception 'invalid game_source';
  end if;

  if p_game_source = 'tournament' then
    select g.home_team_id, g.away_team_id,
           (public.is_tournament_director(g.tournament_id, v_uid)
            or g.scorekeeper_id = v_uid
            or exists (select 1 from public.tournament_roles tr
                       where tr.tournament_id = g.tournament_id
                         and tr.user_id = v_uid and tr.role = 'scorer'))
      into v_home, v_away, v_is_staff
    from public.games g
    where g.id = p_game_id;
  else
    select lg.home_team_id, lg.away_team_id,
           (public.is_league_commissioner(lg.league_id, v_uid)
            or public.is_league_manager(lg.league_id, v_uid)
            or lg.scorekeeper_id = v_uid)
      into v_home, v_away, v_is_staff
    from public.league_games lg
    where lg.id = p_game_id;
  end if;

  if v_home is null and v_away is null then
    raise exception 'game not found';
  end if;
  if not coalesce(v_is_staff, false) then
    raise exception 'only game staff can record sign-offs' using errcode = '42501';
  end if;
  -- a coach sign-off must name its team, and it must be one of this game's teams
  if p_role in ('home_coach','visiting_coach') then
    if p_team_id is null or p_team_id not in (v_home, v_away) then
      raise exception 'a coach sign-off must reference one of this game''s teams';
    end if;
  end if;

  insert into public.game_signoffs (
    game_id, game_source, role, phase, team_id, signer_profile_id,
    printed_name, signature_path, cep_number, cep_level, cep_year,
    official_designation, is_head_coach, created_by
  ) values (
    p_game_id, p_game_source, p_role, p_phase, p_team_id, null,
    btrim(p_printed_name), p_signature_path,
    nullif(btrim(coalesce(p_cep_number,'')), ''),
    nullif(btrim(coalesce(p_cep_level,'')), ''),
    nullif(btrim(coalesce(p_cep_year,'')), ''),
    p_official_designation, coalesce(p_is_head_coach, false), v_uid
  )
  returning * into v_row;

  return v_row;
end $$;

revoke all on function public.record_game_signoff(uuid, text, text, text, uuid, text, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.record_game_signoff(uuid, text, text, text, uuid, text, text, text, text, text, text, boolean) to authenticated, service_role;
