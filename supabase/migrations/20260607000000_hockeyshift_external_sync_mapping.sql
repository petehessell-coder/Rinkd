-- HockeyShift / ShiftStats external-source sync mapping.
-- Backs the sync-hockeyshift edge function (the "Rinkd Social import wedge":
-- operators keep scoring in HockeyShift, Rinkd pulls results into league_*).
-- Already applied to prod via MCP on 2026-06-07; idempotent for repo parity.
--
-- Plain TEXT columns, NO foreign keys (intentional — a 2nd FK on a feed-embedded
-- table causes PostgREST embed ambiguity → blank feeds).

alter table public.league_teams add column if not exists external_source text;
alter table public.league_teams add column if not exists external_id text;
alter table public.league_games add column if not exists external_source text;
alter table public.league_games add column if not exists external_id text;

-- Idempotent upsert targets. NULLS DISTINCT (PG default) keeps the many native
-- (null,null) rows from colliding.
create unique index if not exists league_teams_external_uidx
  on public.league_teams (external_source, external_id);
create unique index if not exists league_games_external_uidx
  on public.league_games (external_source, external_id);

-- XRHL (eXtreme Roller Hockey League) -> ShiftStats division 48313.
-- Map the 4 curated teams to their ShiftStats team IDs, by name within the league.
update public.league_teams set external_source='hockeyshift', external_id='657821'
  where league_id='a1b2c3d4-e5f6-7890-abcd-ef1234567890' and team_name='419 Bladers';
update public.league_teams set external_source='hockeyshift', external_id='657820'
  where league_id='a1b2c3d4-e5f6-7890-abcd-ef1234567890' and team_name='Toledo Sasquatches';
update public.league_teams set external_source='hockeyshift', external_id='657818'
  where league_id='a1b2c3d4-e5f6-7890-abcd-ef1234567890' and team_name='Glass City Pain';
update public.league_teams set external_source='hockeyshift', external_id='657819'
  where league_id='a1b2c3d4-e5f6-7890-abcd-ef1234567890' and team_name='Maumee Bay Ghost Frogs';

update public.leagues
set settings = coalesce(settings,'{}'::jsonb)
  || jsonb_build_object('hockeyshift', jsonb_build_object('provider','shiftstats','division_id',48313))
where id='a1b2c3d4-e5f6-7890-abcd-ef1234567890';
