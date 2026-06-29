-- Event-Centric Home: admin-pinnable Featured hero.
-- A nullable-default-false flag on both event types so the home's Featured
-- layer can pin a specific league/tournament (auto-fallback to largest/live
-- when none pinned). Indexed partial so the "is anything pinned?" lookup is a
-- tiny index scan, not a seq scan, at Saturday-night load.
--
-- Applied to prod 2026-06-29. Launch featured event = the existing XRHL league.
alter table public.leagues      add column if not exists is_featured boolean not null default false;
alter table public.tournaments  add column if not exists is_featured boolean not null default false;

create index if not exists idx_leagues_is_featured     on public.leagues (is_featured)     where is_featured = true;
create index if not exists idx_tournaments_is_featured on public.tournaments (is_featured) where is_featured = true;

-- Launch featured event = the existing XRHL league (logo + brand color already
-- on the record). Pin it.
update public.leagues set is_featured = true
 where id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
