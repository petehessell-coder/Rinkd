// Hourly cron: ~2 hours before each scheduled game, PUSH the team's
// coaches/managers to set their lines — but ONLY if no lineup is set yet.
// A reminder, never a nag: the game_reminders_sent ledger (kind='lineup_2h')
// guarantees one push per (game, team-side, coach) forever.
//
// Sibling of send-game-reminders (which emails the whole roster ~24h out).
// This one is push-only and coach-only. Window is 1.5–2.5h so the hourly cron
// catches each game exactly once at roughly the 2-hour mark.
//
// Cron (added alongside the 24h email reminder, offset to minute 20):
//   select cron.schedule('rinkd-lineup-reminders-hourly','20 * * * *',
//     $$ select net.http_post(
//          url:='https://tbpoopsyhfuqcbugrjbh.supabase.co/functions/v1/send-lineup-reminders',
//          headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer <CRON_KEY>'),
//          body:='{}'::jsonb, timeout_milliseconds:=60000) $$);
//
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_KEY,
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_KEY = Deno.env.get('CRON_KEY') ?? '';
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:hello@rinkd.app';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

type Side = {
  game_id: string;
  game_source: 'team' | 'league';
  start_iso: string;
  is_home: boolean;
  lineup_team_id: string;   // scope game_lineups + the modal use (league_team.id for league games)
  backing_team_id: string;  // real teams.id — where the coaches live + the deep link
  team_name: string;
  opponent_name: string;
};

// Games starting in the ~2h band (1.5h–2.5h), not final/cancelled.
async function loadDueSides(svc: ReturnType<typeof createClient>): Promise<Side[]> {
  const now = Date.now();
  const start = new Date(now + 90 * 60 * 1000).toISOString();
  const end = new Date(now + 150 * 60 * 1000).toISOString();
  const sides: Side[] = [];

  const { data: tg, error: tgErr } = await svc
    .from('team_games')
    .select('id, start_time, is_home, opponent, team_id, status, team:team_id ( id, name )')
    .gte('start_time', start).lt('start_time', end)
    .neq('status', 'final').neq('status', 'cancelled');
  if (tgErr) console.error('[lineup-reminders] team_games load', tgErr);
  for (const g of (tg ?? []) as any[]) {
    sides.push({
      game_id: g.id, game_source: 'team', start_iso: g.start_time, is_home: !!g.is_home,
      lineup_team_id: g.team_id, backing_team_id: g.team_id,
      team_name: g.team?.name ?? 'Your team', opponent_name: g.opponent ?? 'Opponent',
    });
  }

  const { data: lg, error: lgErr } = await svc
    .from('league_games')
    .select(`
      id, start_time, status, home_team_id, away_team_id,
      home_lt:home_team_id ( id, team_id, team_name, team:team_id ( id, name ) ),
      away_lt:away_team_id ( id, team_id, team_name, team:team_id ( id, name ) )
    `)
    .gte('start_time', start).lt('start_time', end)
    .neq('status', 'final').neq('status', 'cancelled');
  if (lgErr) console.error('[lineup-reminders] league_games load', lgErr);
  for (const g of (lg ?? []) as any[]) {
    for (const s of [
      { isHome: true, self: g.home_lt, opp: g.away_lt, ltId: g.home_team_id },
      { isHome: false, self: g.away_lt, opp: g.home_lt, ltId: g.away_team_id },
    ]) {
      const backing = s.self?.team?.id ?? s.self?.team_id;
      if (!backing || !s.ltId) continue;
      sides.push({
        game_id: g.id, game_source: 'league', start_iso: g.start_time, is_home: s.isHome,
        lineup_team_id: s.ltId, backing_team_id: backing,
        team_name: s.self?.team?.name ?? s.self?.team_name ?? 'Your team',
        opponent_name: s.opp?.team?.name ?? s.opp?.team_name ?? 'Opponent',
      });
    }
  }
  return sides;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // Fail-closed cron gate — only pg_cron (which sends this bearer) may fire.
  const auth = req.headers.get('authorization') ?? '';
  if (!CRON_KEY || auth !== `Bearer ${CRON_KEY}`) return json({ error: 'forbidden' }, 403);
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ ok: false, reason: 'vapid_not_configured' });

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const startedAt = Date.now();

  try {
    const sides = await loadDueSides(svc);
    let pushed = 0, skippedSet = 0, skippedDup = 0, noCoaches = 0, pruned = 0, reminded = 0;

    for (const side of sides) {
      // 1. THE WHOLE POINT: only remind if no lineup is set yet.
      const { data: lu } = await svc.from('game_lineups')
        .select('id').eq('game_id', side.game_id).eq('team_id', side.lineup_team_id).limit(1);
      if (lu && lu.length > 0) { skippedSet++; continue; }

      // 2. Coaches/managers of the backing team (the people who set lines).
      const { data: mgrs } = await svc.from('team_members')
        .select('user_id').eq('team_id', side.backing_team_id)
        .in('role', ['manager', 'coach']).eq('status', 'active').not('user_id', 'is', null);
      let ids = [...new Set((mgrs ?? []).map((m: any) => m.user_id))].filter(Boolean) as string[];
      if (ids.length === 0) { noCoaches++; continue; }

      // 3. Respect the push preference.
      const { data: profs } = await svc.from('profiles')
        .select('id, email, notification_push').in('id', ids);
      const profById = new Map((profs ?? []).map((p: any) => [p.id, p]));
      ids = ids.filter((id) => (profById.get(id)?.notification_push) !== false);
      if (ids.length === 0) continue;

      // 4. Dedupe — one reminder per (game, side, coach) forever.
      const { data: already } = await svc.from('game_reminders_sent')
        .select('user_id').eq('kind', 'lineup_2h')
        .eq('game_id', side.game_id).eq('game_source', side.game_source).in('user_id', ids);
      const sentSet = new Set((already ?? []).map((r: any) => r.user_id));
      const targets = ids.filter((id) => !sentSet.has(id));
      if (targets.length === 0) { skippedDup++; continue; }

      // 5. Push (best-effort), prune stale subscriptions.
      const { data: subs } = await svc.from('push_subscriptions')
        .select('user_id, subscription').in('user_id', targets);
      const title = `🏒 ${side.team_name} ${side.is_home ? 'vs.' : '@'} ${side.opponent_name}`;
      const body = 'Game in ~2 hours — tap to set your lines.';
      const url = `/team/${side.backing_team_id}`;
      const tag = `lineup-reminder:${side.game_id}:${side.lineup_team_id}`;
      const payload = JSON.stringify({ title, body, url, tag });

      const stale: string[] = [];
      for (const s of (subs ?? []) as any[]) {
        let parsed: unknown;
        try { parsed = JSON.parse(s.subscription); } catch { stale.push(s.user_id); continue; }
        try { await webpush.sendNotification(parsed as { endpoint: string }, payload); pushed++; }
        catch (err) {
          const sc = (err as { statusCode?: number })?.statusCode;
          if (sc === 404 || sc === 410) stale.push(s.user_id);
          else console.error('[lineup-reminders] push fail', { game: side.game_id, sc });
        }
      }
      if (stale.length) { await svc.from('push_subscriptions').delete().in('user_id', stale); pruned += stale.length; }

      // 6. Ledger — one row per coach reminded (even with no sub: still
      //    "reminded", so we never re-evaluate them for this game).
      const rows = targets.map((id) => ({
        game_id: side.game_id, game_source: side.game_source, user_id: id,
        email: profById.get(id)?.email ?? null, kind: 'lineup_2h', resend_id: null,
      }));
      if (rows.length) { await svc.from('game_reminders_sent').insert(rows); reminded += rows.length; }
    }

    return json({
      ok: true, sides: sides.length, coaches_reminded: reminded, pushes_sent: pushed,
      skipped_lines_already_set: skippedSet, skipped_dup: skippedDup, no_coaches: noCoaches,
      pruned, elapsed_ms: Date.now() - startedAt,
    });
  } catch (err) {
    console.error('[lineup-reminders] fatal', err);
    return json({ ok: false, error: String((err as Error)?.message || err) }, 500);
  }
});
