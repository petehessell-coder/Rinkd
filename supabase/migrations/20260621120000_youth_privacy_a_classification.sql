-- ============================================================================
-- YOUTH-PRIVACY · Migration A — team classification + derived visibility gate
-- ----------------------------------------------------------------------------
-- Youth (minor) teams are PRIVATE / invite-only and can NEVER be made public
-- through the API. Adult teams default public (personal contacts gated
-- separately in Migration C). Unknown classification => conservative youth.
--
-- `is_youth` is the classification (the "why"); `visibility` is the gate (the
-- "what RLS enforces"). visibility is auto-derived from is_youth by a trigger —
-- it is NOT a free toggle a volunteer could set wrong, and youth->public is
-- hard-rejected. Legacy `is_public` is kept mirrored so any remaining readers
-- stay correct during the frontend transition.
-- ============================================================================

alter table public.teams
  add column if not exists is_youth boolean not null default true,
  add column if not exists visibility text not null default 'private';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'teams_visibility_check'
  ) then
    alter table public.teams
      add constraint teams_visibility_check check (visibility in ('public','private'));
  end if;
end $$;

comment on column public.teams.is_youth is
  'True = youth/minor team (COPPA-gated, private). Auto-derived; default true (conservative). Drives the visibility floor.';
comment on column public.teams.visibility is
  'Derived gate: youth => always private; adult => public unless a manager opts private. Enforced by tg_teams_derive_visibility(); youth->public is rejected.';

-- ----------------------------------------------------------------------------
-- Conservative classifier — used by the create flow + go-forward inserts.
-- Returns true (youth) unless there is a CLEAR adult signal and NO youth
-- signal. Default-deny leans youth so an unclassified team is born private.
-- (The one-time backfill below intentionally uses a narrower rule so existing,
--  demonstrably-adult, minor-free teams keep their current public visibility.)
-- ----------------------------------------------------------------------------
create or replace function public.derive_is_youth(p_division text, p_level text, p_extra text default null)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  with t as (
    select lower(concat_ws(' ', coalesce(p_division,''), coalesce(p_level,''), coalesce(p_extra,''))) as s
  )
  select case
    -- youth age/competitive signals win (default-deny leans youth)
    when (select s from t) ~ '(\m\d{1,2}\s*u\M|\mu\d{1,2}\M|mite|squirt|pee.?wee|bantam|midget|youth|prep|varsity|\mjv\M|\maaa\M|\maa\M|high.?school|peewee)'
      then true
    -- clear adult signals => adult
    when (select s from t) ~ '(beer|adult|senior|\mmen\M|\mwomen\M|co.?ed|\mrec\M|\mopen\M|oldtimer|master|\m18\+|\m\d0\+|\mccc\M|\mcc\M|\mc\M)'
      then false
    -- unknown => conservative youth/private
    else true
  end;
$$;

-- Admin check that bypasses RLS (also used by Migration B's policies). Defined
-- here because the visibility trigger's declassification guard needs it.
create or replace function public.current_user_is_admin()
returns boolean language sql stable security definer set search_path to 'public'
as $$ select exists (select 1 from public.profiles p where p.id = public.current_profile_id() and p.is_admin); $$;
revoke all on function public.current_user_is_admin() from public;
grant execute on function public.current_user_is_admin() to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Visibility derivation + youth->public guard. BEFORE INSERT OR UPDATE so the
-- gate can never diverge from is_youth and a youth team can never be public.
-- ----------------------------------------------------------------------------
create or replace function public.tg_teams_derive_visibility()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  -- Declassifying a youth team (true->false) is the only API path that could
  -- ever unlock public for a minor roster — restrict it to admins. The
  -- current_profile_id() guard exempts the migration/backfill + service_role
  -- (no auth context), and short-circuits before current_user_is_admin().
  if tg_op = 'UPDATE'
     and coalesce(OLD.is_youth, true) = true and coalesce(NEW.is_youth, true) = false
     and public.current_profile_id() is not null
     and not public.current_user_is_admin() then
    raise exception 'only an admin can reclassify a youth team as an adult team'
      using errcode = '42501';
  end if;

  if coalesce(NEW.is_youth, true) then
    -- youth (or unknown): always private; explicit public is rejected.
    if NEW.visibility = 'public' then
      raise exception 'a youth team cannot be made public (COPPA child-safety). Set is_youth=false first.'
        using errcode = '42501';
    end if;
    NEW.visibility := 'private';
  else
    -- adult: public unless explicitly private.
    if NEW.visibility is null then NEW.visibility := 'public'; end if;
    if NEW.visibility not in ('public','private') then
      raise exception 'visibility must be public or private';
    end if;
  end if;
  -- mirror legacy is_public for any readers still on the old column
  NEW.is_public := (NEW.visibility = 'public');
  return NEW;
end;
$$;

drop trigger if exists trg_teams_derive_visibility on public.teams;
create trigger trg_teams_derive_visibility
  before insert or update on public.teams
  for each row execute function public.tg_teams_derive_visibility();

-- ----------------------------------------------------------------------------
-- is_youth_team(team) — conservative helper (missing team => youth/private).
-- ----------------------------------------------------------------------------
create or replace function public.is_youth_team(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((select is_youth from public.teams where id = p_team_id), true);
$$;

revoke all on function public.is_youth_team(uuid) from public;
grant execute on function public.is_youth_team(uuid) to anon, authenticated, service_role;
grant execute on function public.derive_is_youth(text, text, text) to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- One-time backfill (operator decision 2026-06-21): an EXISTING team is youth
-- iff it carries a youth age-signal OR actually has a minor on its roster.
-- Every other existing team is minor-free and currently public, so it stays
-- adult/public to preserve discoverability. New teams use the conservative
-- default (is_youth=true) instead. The two statements fire the trigger, which
-- sets visibility + mirrors is_public.
-- ----------------------------------------------------------------------------
update public.teams t set is_youth = (
  exists (
    select 1 from public.team_members tm
    join public.profiles p on p.id = tm.user_id
    where tm.team_id = t.id and p.account_type = 'minor'
  )
  or lower(concat_ws(' ', coalesce(t.division,''), coalesce(t.level,''))) ~
     '(\m\d{1,2}\s*u\M|\mu\d{1,2}\M|mite|squirt|pee.?wee|peewee|bantam|midget|youth|prep|varsity|\mjv\M|\maaa\M|\maa\M|high.?school)'
);

update public.teams set visibility = case when is_youth then 'private' else 'public' end;
