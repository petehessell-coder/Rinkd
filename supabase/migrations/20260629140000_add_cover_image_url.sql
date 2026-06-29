-- Featured hero photo background. The design ("gradients must be earned") wants
-- a real arena/rink photo behind the Featured card. This nullable per-event
-- override lets an admin pin a photo; the home falls back to an authorized
-- default arena image when null, so the hero is photographic either way.
-- Applied to prod 2026-06-29.
alter table public.leagues      add column if not exists cover_image_url text;
alter table public.tournaments  add column if not exists cover_image_url text;
