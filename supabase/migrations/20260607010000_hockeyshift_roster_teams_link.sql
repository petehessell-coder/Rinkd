-- Roster import support for the HockeyShift sync.
-- Already applied to prod via MCP on 2026-06-07; idempotent for repo parity.
--
-- Rosters render via global teams + team_members (league_teams.team_id links the
-- two). XRHL's league_teams were created with team_id=null, so this (a) gives
-- team_members an external-id mapping for idempotent roster upserts and (b)
-- creates + links a global team per XRHL league_team.

-- 1) Idempotent roster upsert key.
alter table public.team_members add column if not exists external_source text;
alter table public.team_members add column if not exists external_id text;
create unique index if not exists team_members_external_uidx
  on public.team_members (external_source, external_id);

-- 2) Create a global teams row per XRHL league_team (mirrors curated logo/name).
insert into public.teams
  (name, slug, level, location, home_rink, logo_color, logo_initials, logo_url,
   is_public, is_verified, source, external_id, external_source_url, imported_at)
select
  lt.team_name,
  trim(both '-' from regexp_replace(lower(lt.team_name), '[^a-z0-9]+', '-', 'g')) || '-hs' || lt.external_id,
  'Roller Hockey', 'Toledo, OH', 'Huntington Center',
  lt.logo_color, lt.logo_initials, lt.logo_url,
  true, false, 'external:hockeyshift', lt.external_id, 'https://www.xrhl.net/stats', now()
from public.league_teams lt
where lt.league_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
  and lt.external_source = 'hockeyshift'
on conflict (source, external_id) do nothing;

-- 3) Link each XRHL league_team to its new global team via shared external_id.
update public.league_teams lt
set team_id = t.id
from public.teams t
where lt.league_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
  and lt.external_source = 'hockeyshift'
  and t.source = 'external:hockeyshift'
  and t.external_id = lt.external_id
  and lt.team_id is null;
