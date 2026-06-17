-- GAMESHEET-LEAGUES-1 — extend the GameSheet results poller to leagues.
--
-- The tournament path (gamesheet_links owned by a tournament) is live + cron'd.
-- This migration makes the SAME tables owner-polymorphic so a league
-- commissioner can link a GameSheet season to their league, and the
-- sync-gamesheet cron mirrors scores → league_games (+ auto-import + recap +
-- one-tap pending matches), exactly like the tournament path.
--
-- Nothing here touches the tournament path's behaviour: tournament_id-owned
-- links keep their existing director RLS (is_tournament_director is null-safe —
-- it returns false for a NULL tournament_id, so league-owned rows simply fall
-- through that policy and are governed by the new commissioner policy below).

-- 1. gamesheet_links: allow a link to be owned by a LEAGUE instead of a tournament.
--    Exactly one owner — tournament XOR league (num_nonnulls == 1).
alter table public.gamesheet_links alter column tournament_id drop not null;
alter table public.gamesheet_links
  add column league_id uuid references public.leagues(id) on delete cascade,
  add column league_division_id uuid references public.league_divisions(id) on delete cascade;
alter table public.gamesheet_links
  add constraint gamesheet_links_one_owner check (num_nonnulls(tournament_id, league_id) = 1);

-- 2. gamesheet_game_map.rinkd_game_id must be able to hold a league_games id too,
--    so drop the games-only FK. The column becomes a loose uuid (games.id OR
--    league_games.id). Safe: link_id's ON DELETE CASCADE already removes map
--    rows when the link (and its owning tournament/league) is deleted, so we
--    don't rely on this FK's per-game SET NULL.
alter table public.gamesheet_game_map drop constraint gamesheet_game_map_rinkd_game_id_fkey;

-- 3. League recap primitive — mirror of posts.recap_for_game_id, but FK'd to
--    league_games. Lets the poller upsert exactly one auto-recap per league game
--    (posts.recap_for_game_id FKs games(id) and can't hold a league_games id).
alter table public.posts
  add column recap_for_league_game_id uuid references public.league_games(id) on delete set null;
create unique index posts_recap_for_league_game_id_unique_idx
  on public.posts (recap_for_league_game_id) where recap_for_league_game_id is not null;

-- 4. RLS — a league commissioner manages their league's links + maps (mirror of
--    the existing director policies, keyed on league_id via is_league_commissioner).
--    The director policies are left untouched; the two owner types are disjoint.
create policy gamesheet_links_commish_all on public.gamesheet_links for all to authenticated
  using (league_id is not null and is_league_commissioner(league_id, (select current_profile_id())))
  with check (league_id is not null and is_league_commissioner(league_id, (select current_profile_id())));

create policy gamesheet_game_map_commish_all on public.gamesheet_game_map for all to authenticated
  using (exists (select 1 from public.gamesheet_links l
                 where l.id = link_id and l.league_id is not null
                   and is_league_commissioner(l.league_id, (select current_profile_id()))))
  with check (exists (select 1 from public.gamesheet_links l
                      where l.id = link_id and l.league_id is not null
                        and is_league_commissioner(l.league_id, (select current_profile_id()))));
