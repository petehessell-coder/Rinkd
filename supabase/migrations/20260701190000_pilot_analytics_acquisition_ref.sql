-- PILOT-ANALYTICS: durable per-pilot attribution.
-- Nullable, additive; no existing code reads it. Written once on first profile
-- creation (client lib/auth.js ensureProfileForUser — a plain UPDATE, no
-- RETURNING, so it is immune to the youth-privacy column gate on
-- profiles.email/date_of_birth). Pilots hand out links/QRs like
-- rinkd.app/?ref=little-caesars; the client captures first-touch ?ref/utm_source.
-- Applied to prod 2026-07-01 (via MCP apply_migration).

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS acquisition_ref text;

CREATE INDEX IF NOT EXISTS idx_profiles_acquisition_ref
  ON public.profiles (acquisition_ref)
  WHERE acquisition_ref IS NOT NULL;
