// GAMEDAY-1 — the ~2-hours-out pre-game HYPE push (the first beat of the
// schedule-driven game-day loop; the live float + auto-recap live in the app).
//
// Cron-invoked (no user JWT — deploy with verify_jwt = false, same as
// send-game-reminders). Finds games tipping off in ~2h across every tournament
// and league, and pushes a hype notification to that EVENT's followers — the
// same audience the recap push already targets, so following an event lights up
// the whole loop. Dedup reuses the existing game_reminders_sent ledger with a
// new kind ('hype_2h') — NO schema change.
//
// Scale: bounded by the time band (only games in a ~30-min window each run) and
// the existing per-event subscriber sets. Idempotent via the ledger, so an
// overlapping cron run never double-fires.
//
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY, VAPID_SUBJECT.
//
// Suggested cron (every 30 min):
//   select cron.schedule('rinkd-gameday-hype','*/30 * * * *',
//     $$ select net.http_post(
//          url:='https://<proj>.supabase.co/functions/v1/send-gameday-hype',
//          headers:='{"Content-Type":"application/json"}'::jsonb) $$);

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:hello@rinkd.app';
if (VAPID_PUBLIC && VAPID_PRIVATE) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

type Game = {
  id: string; source: 'tournament' | 'league';
  eventId: string; eventName: string; home: string; away: string;
};

// Games starting in the ~2h band. The 1.75–2.25h window + a 30-min cron means
// each game lands in exactly one run; the ledger guards any overlap.
async function loadHypeGames(supabase: ReturnType<typeof createClient>): Promise<Game[]> {
  const now = Date.now();
  const start = new Date(now + 1.75 * 3600 * 1000).toISOString();
  const end = new Date(now + 2.25 * 3600 * 1000).toISOString();
  const out: Game[] = [];

  const { data: tGames, error: tErr } = await supabase
    .from('games')
    .select('id, start_time, status, tournament_id, home_team:tournament_teams!home_team_id(team_name), away_team:tournament_teams!away_team_id(team_name), tournament:tournaments(name)')
    .eq('status', 'scheduled').gte('start_time', start).lt('start_time', end);
  if (tErr) console.error('[gameday-hype] games load error:', tErr.message);
  for (const g of (tGames ?? []) as any[]) {
    if (!g.tournament_id) continue;
    out.push({ id: g.id, source: 'tournament', eventId: g.tournament_id, eventName: g.tournament?.name ?? 'the tournament', home: g.home_team?.team_name ?? 'Home', away: g.away_team?.team_name ?? 'Away' });
  }

  const { data: lGames, error: lErr } = await supabase
    .from('league_games')
    .select('id, start_time, status, league_id, home_lt:league_teams!home_team_id(team_name, team:teams(name)), away_lt:league_teams!away_team_id(team_name, team:teams(name)), league:leagues(name)')
    .eq('status', 'scheduled').gte('start_time', start).lt('start_time', end);
  if (lErr) console.error('[gameday-hype] league_games load error:', lErr.message);
  for (const g of (lGames ?? []) as any[]) {
    if (!g.league_id) continue;
    out.push({ id: g.id, source: 'league', eventId: g.league_id, eventName: g.league?.name ?? 'the league', home: g.home_lt?.team?.name ?? g.home_lt?.team_name ?? 'Home', away: g.away_lt?.team?.name ?? g.away_lt?.team_name ?? 'Away' });
  }
  return out;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ error: 'VAPID keys must be set as Edge Function secrets' }, 500);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const games = await loadHypeGames(supabase);
  if (!games.length) return json({ games: 0, sent: 0, reason: 'no_games_in_window' });

  // Ledger: which (game, user) hype pushes already went out.
  const gameIds = games.map((g) => g.id);
  const { data: ledger } = await supabase
    .from('game_reminders_sent').select('game_id, user_id').eq('kind', 'hype_2h').in('game_id', gameIds);
  const seen = new Set<string>((ledger ?? []).map((r: any) => `${r.game_id}|${r.user_id}`));

  const stale: string[] = [];
  let sent = 0, attempted = 0;

  for (const g of games) {
    // The event's followers — the recap push's exact audience.
    const subTable = g.source === 'tournament' ? 'tournament_subscriptions' : 'league_subscriptions';
    const subCol = g.source === 'tournament' ? 'tournament_id' : 'league_id';
    const { data: subs } = await supabase.from(subTable).select('user_id').eq(subCol, g.eventId);
    const userIds = (subs ?? []).map((s: any) => s.user_id).filter((uid: string) => !seen.has(`${g.id}|${uid}`));
    if (!userIds.length) continue;

    const { data: pushSubs } = await supabase
      .from('push_subscriptions').select('user_id, subscription').in('user_id', userIds);
    if (!pushSubs || !pushSubs.length) continue;

    const title = `🏒 ${g.away} @ ${g.home}`;
    const body = `Puck drops in about 2 hours · ${g.eventName}. Tap for the matchup and head-to-head.`;
    const url = g.source === 'tournament' ? `/game/${g.id}` : `/league-game/${g.id}?type=league`;
    const payload = JSON.stringify({ title, body, url, tag: `hype:${g.id}` });

    const delivered: string[] = [];
    await Promise.all(pushSubs.map(async (s: any) => {
      attempted++;
      let parsed: unknown;
      try { parsed = JSON.parse(s.subscription); } catch { stale.push(s.user_id); return; }
      try {
        await webpush.sendNotification(parsed as { endpoint: string }, payload);
        sent++; delivered.push(s.user_id);
      } catch (err) {
        const code = (err as { statusCode?: number })?.statusCode;
        if (code === 410 || code === 404) stale.push(s.user_id);
        else console.error('[gameday-hype] delivery failed', { game_id: g.id, user_id: s.user_id, code });
      }
    }));

    // Record the ledger for everyone we targeted (delivered OR skipped) so a
    // re-run never re-fires, even for a user whose push later expired.
    if (userIds.length) {
      await supabase.from('game_reminders_sent').insert(
        userIds.map((uid: string) => ({ game_id: g.id, game_source: g.source, user_id: uid, kind: 'hype_2h' }))
      );
    }
  }

  if (stale.length) await supabase.from('push_subscriptions').delete().in('user_id', stale);
  return json({ games: games.length, sent, attempted, pruned: stale.length });
});
