import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { getGamedayContext, getGamedayGames } from '../../lib/gameday';
import LiveGameCard from './LiveGameCard';
import HypeCard from './HypeCard';

// =============================================================================
// GamedayStrip — the schedule-driven surface that floats above the feed.
// Live games (top, pulsing) → the next upcoming game's hype card. Recaps come
// through the normal post stream (RecapCard), closing the loop.
//
// Scale (CLAUDE.md): bounded queries (see lib/gameday) + Supabase Realtime, no
// polling. We subscribe to the followed events' game tables and re-run the
// bounded loader on a debounced ping, so a goal or a status flip refreshes the
// strip without a single poll. Unsubscribes on unmount.
// =============================================================================
export default function GamedayStrip({ currentUserId, navigate }) {
  const [state, setState] = useState({ live: [], upcoming: [] });
  const ctxRef = useRef(null);

  useEffect(() => {
    if (!currentUserId) return undefined;
    let alive = true;
    let channel = null;
    let debounce = null;

    const refresh = () =>
      getGamedayGames(currentUserId, { ctx: ctxRef.current }).then((r) => { if (alive) setState(r); });
    // Coalesce realtime bursts (a flurry of goals) into one bounded re-query.
    const ping = () => { clearTimeout(debounce); debounce = setTimeout(refresh, 600); };

    (async () => {
      const ctx = await getGamedayContext(currentUserId);
      if (!alive) return;
      ctxRef.current = ctx;
      if (!ctx.tournamentIds.length && !ctx.leagueIds.length) return;
      await refresh();

      // One channel, server-filtered per followed event. Typical users follow a
      // handful of events; we cap the bindings so a power-follower can't open an
      // unbounded number of subscriptions.
      channel = supabase.channel(`gameday-${currentUserId}`);
      ctx.tournamentIds.slice(0, 20).forEach((tid) => {
        channel.on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `tournament_id=eq.${tid}` }, ping);
      });
      ctx.leagueIds.slice(0, 20).forEach((lid) => {
        channel.on('postgres_changes', { event: '*', schema: 'public', table: 'league_games', filter: `league_id=eq.${lid}` }, ping);
      });
      channel.subscribe();
    })();

    return () => {
      alive = false;
      clearTimeout(debounce);
      if (channel) { try { supabase.removeChannel(channel); } catch { /* swallow */ } }
    };
  }, [currentUserId]);

  const { live, upcoming } = state;
  if (!live.length && !upcoming.length) return null;
  const hype = upcoming[0]; // soonest only — the feed is the main event, not this

  return (
    <div>
      {live.map((g) => <LiveGameCard key={`${g.source}:${g.id}`} game={g} navigate={navigate} />)}
      {hype && <HypeCard key={`${hype.source}:${hype.id}`} game={hype} currentUserId={currentUserId} navigate={navigate} />}
    </div>
  );
}
