-- SOCIAL-3 — Game Puck Phase 2 ACTIVATION.
--
-- Schedules the settle cron: every 30 min, settle any final game with Game Puck
-- votes that went final ≥24h ago (records the winner, auto-posts the Fans' Pick,
-- notifies + pushes the winner, locks voting).
--
-- ⚠️ DO NOT APPLY until the Phase-2 UI is live (the settled/locked card state +
-- the 'game_puck_won' notification rendering). Applying this is the go-live switch:
-- once scheduled, settled games start showing the locked state + auto-posts appear.
-- Un-schedule with:  SELECT cron.unschedule('rinkd-settle-game-pucks');

SELECT cron.schedule(
  'rinkd-settle-game-pucks',
  '*/30 * * * *',
  $$ SELECT public.settle_due_game_pucks(); $$
);
