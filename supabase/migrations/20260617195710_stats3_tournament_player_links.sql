-- STATS-3 Step 4a/4b: adults-only durable jersey<->profile link for tournaments.
-- Populates game_lineups.user_id so get_player_tournament_stats lights up.
-- Minors stay gated: writes go ONLY through the SECURITY DEFINER RPCs below,
-- which hard-block is_minor_profile. No direct table write policy exists.
create table if not exists public.tournament_player_links (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  tournament_team_id uuid not null references public.tournament_teams(id) on delete cascade,
  jersey_number int not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  linked_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tournament_team_id, jersey_number)
);
alter table public.tournament_player_links enable row level security;
-- public read; writes ONLY through the SECURITY DEFINER RPCs below (no write
-- policy => RLS denies any direct client INSERT/UPDATE/DELETE).
drop policy if exists tpl_read on public.tournament_player_links;
create policy tpl_read on public.tournament_player_links for select using (true);

-- new tournament lineup rows auto-inherit the linked (adult) user, so games
-- added AFTER linking light up too. Fires AFTER tr_block_minor_lineup_bind
-- (alphabetical) but can only ever inherit an ADULT, because the link table is
-- adults-only by RPC construction; only acts when user_id is still NULL.
create or replace function public.tg_inherit_tournament_lineup_user() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if NEW.game_source = 'tournament' and NEW.user_id is null and NEW.jersey_number is not null then
    select l.user_id into NEW.user_id
    from public.tournament_player_links l
    where l.tournament_team_id = NEW.team_id and l.jersey_number = NEW.jersey_number;
  end if;
  return NEW;
end; $$;
drop trigger if exists trg_inherit_tournament_lineup_user on public.game_lineups;
create trigger trg_inherit_tournament_lineup_user before insert on public.game_lineups
  for each row execute function public.tg_inherit_tournament_lineup_user();

-- link (adults only) + backfill existing rows
create or replace function public.link_tournament_player(p_tournament_team_id uuid, p_jersey int, p_user_id uuid)
returns int language plpgsql security definer set search_path to 'public' as $$
declare v_tid uuid; v_caller uuid := (select current_profile_id()); v_n int;
begin
  select tournament_id into v_tid from public.tournament_teams where id = p_tournament_team_id;
  if v_tid is null then raise exception 'tournament team not found'; end if;
  -- authz: tournament director OR the user claiming their own jersey
  if not (is_tournament_director(v_tid, v_caller) or v_caller = p_user_id) then
    raise exception 'not authorized to link this player'; end if;
  -- ADULTS ONLY — minors require the guardian-consent path (not enabled in this build)
  if is_minor_profile(p_user_id) then
    raise exception 'linking minors requires guardian consent (not enabled)'; end if;
  -- self-serve may only claim an UNLINKED jersey; reassignment requires a director
  if not is_tournament_director(v_tid, v_caller)
     and exists (select 1 from public.tournament_player_links where tournament_team_id=p_tournament_team_id and jersey_number=p_jersey) then
    raise exception 'jersey already linked — ask the tournament director to reassign'; end if;

  insert into public.tournament_player_links (tournament_id, tournament_team_id, jersey_number, user_id, linked_by)
  values (v_tid, p_tournament_team_id, p_jersey, p_user_id, v_caller)
  on conflict (tournament_team_id, jersey_number)
  do update set user_id = excluded.user_id, linked_by = excluded.linked_by, created_at = now();

  update public.game_lineups gl set user_id = p_user_id
  from public.games g
  where gl.game_id = g.id and g.tournament_id = v_tid
    and gl.team_id = p_tournament_team_id and gl.game_source = 'tournament' and gl.jersey_number = p_jersey;
  get diagnostics v_n = row_count; return v_n;
end; $$;
grant execute on function public.link_tournament_player(uuid,int,uuid) to authenticated;

create or replace function public.unlink_tournament_player(p_tournament_team_id uuid, p_jersey int)
returns int language plpgsql security definer set search_path to 'public' as $$
declare v_tid uuid; v_caller uuid := (select current_profile_id()); v_uid uuid; v_n int;
begin
  select tournament_id into v_tid from public.tournament_teams where id = p_tournament_team_id;
  select user_id into v_uid from public.tournament_player_links where tournament_team_id=p_tournament_team_id and jersey_number=p_jersey;
  if not (is_tournament_director(v_tid, v_caller) or v_caller = v_uid) then raise exception 'not authorized'; end if;
  delete from public.tournament_player_links where tournament_team_id=p_tournament_team_id and jersey_number=p_jersey;
  update public.game_lineups gl set user_id = null
  from public.games g
  where gl.game_id=g.id and g.tournament_id=v_tid and gl.team_id=p_tournament_team_id
    and gl.game_source='tournament' and gl.jersey_number=p_jersey and gl.user_id = v_uid;
  get diagnostics v_n=row_count; return v_n;
end; $$;
grant execute on function public.unlink_tournament_player(uuid,int) to authenticated;
