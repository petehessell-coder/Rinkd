// perf(scale) — the spectator live-game subscription, in one place.
//
// THE 10k PROBLEM: PublicGame / GameDetail / the Gameday strip each had every
// spectator open their OWN `postgres_changes` subscription on the game. 10k fans
// on one hot game = 10k server-side subscriptions, and Postgres re-evaluates RLS
// PER changed row × PER subscriber on every goal. A shared channel *name* does
// NOT dedupe this — postgres_changes is O(viewers), not O(games). (The old
// PublicGame comment claimed otherwise; it was wrong and hid the ceiling.)
//
// THE FIX: Supabase **Broadcast from the database** — a trigger emits one message
// to a per-game topic on each write (see supabase/migrations-pending/
// 20260619_game_broadcast.sql). Spectators subscribe to that ONE topic, so there
// is no per-subscriber RLS-per-row work: it scales O(games).
//
// ROLLOUT IS GATED so this is safe to ship BEFORE the migration is applied +
// device-tested. With REACT_APP_GAME_BROADCAST unset (default) we keep today's
// postgres_changes path verbatim — zero behaviour change. Set it to '1' once the
// trigger + RLS are live and verified on a real device, and every spectator
// surface upgrades to the shared topic with no further code change.
//
//   const unsub = subscribeGame({ kind: 'league'|'tournament'|'team', gameId, onChange });
//   // ...on unmount:
//   unsub();

import { supabase } from './supabase';

const BROADCAST_ON = process.env.REACT_APP_GAME_BROADCAST === '1';

// kind → the row table whose changes mean "this game updated".
const ROW_TABLE = { league: 'league_games', team: 'team_games', tournament: 'games' };

export function subscribeGame({ kind = 'tournament', gameId, onChange }) {
  if (!gameId || typeof onChange !== 'function') return () => {};
  const topic = `game:${kind}:${gameId}`;

  // --- Scaled path: one shared broadcast topic per game (O games) -----------
  if (BROADCAST_ON) {
    let channel = null;
    try {
      channel = supabase
        .channel(topic, { config: { broadcast: { self: false } } })
        // The trigger sends a lightweight ping; we re-fetch the snapshot on it
        // rather than trusting the payload (keeps RLS in the read query).
        .on('broadcast', { event: 'update' }, () => onChange())
        .subscribe();
    } catch { /* realtime is best-effort; the surface still works without it */ }
    return () => { try { if (channel) supabase.removeChannel(channel); } catch { /* swallow */ } };
  }

  // --- Default path: postgres_changes (correct, but O viewers) --------------
  // Kept verbatim so nothing changes until the broadcast path is proven.
  const rowTable = ROW_TABLE[kind] || 'games';
  let channel = null;
  try {
    let ch = supabase
      .channel(topic)
      .on('postgres_changes', { event: '*', schema: 'public', table: rowTable, filter: `id=eq.${gameId}` }, () => onChange());
    // Tournament/league games keep their scoring in game_goals; team_games don't.
    if (kind !== 'team') {
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: 'game_goals', filter: `game_id=eq.${gameId}` }, () => onChange());
    }
    ch.subscribe();
    channel = ch;
  } catch { /* best-effort */ }
  return () => { try { if (channel) supabase.removeChannel(channel); } catch { /* swallow */ } };
}
