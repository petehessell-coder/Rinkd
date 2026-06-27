// Hourly cron: emails every player whose game starts in ~24h.
// Ledger table game_reminders_sent prevents duplicate sends across retries.
//
// Trigger via pg_cron:
//   select cron.schedule('rinkd-game-reminders-hourly','0 * * * *',
//     $$ select net.http_post(
//          url:='https://tbpoopsyhfuqcbugrjbh.supabase.co/functions/v1/send-game-reminders',
//          headers:=jsonb_build_object('Authorization','Bearer '||current_setting('app.cron_key'))
//        ) $$);
//
// Manual trigger:
//   curl -X POST https://tbpoopsyhfuqcbugrjbh.supabase.co/functions/v1/send-game-reminders \
//        -H "Authorization: Bearer $CRON_KEY"

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const CRON_KEY = Deno.env.get('CRON_KEY') ?? '';
const FROM = 'Rinkd <hello@rinkd.app>';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function escape(s: string | null | undefined): string {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string));
}

function fmtGameTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      weekday: 'long', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    });
  } catch { return iso; }
}

function emailHtml(params: {
  toName: string;
  teamName: string;
  opponentName: string;
  isHome: boolean;
  startIso: string;
  endIso?: string | null;
  location: string;
  gameUrl: string;
  leagueName?: string | null;
  eventType?: 'game' | 'practice' | 'event';
  title?: string | null;
}): string {
  const { toName, teamName, opponentName, isHome, startIso, endIso, location, gameUrl, leagueName, eventType = 'game', title } = params;
  const isGame = eventType === 'game';
  const icon = isGame ? '🏒' : eventType === 'practice' ? '🧊' : '📋';
  // Headline: game = matchup; practice/event = team + label.
  const headline = isGame
    ? `${icon} ${escape(teamName)} ${isHome ? 'vs.' : '@'} ${escape(opponentName)}`
    : `${icon} ${escape(title || (eventType === 'practice' ? 'Practice' : 'Event'))}`;
  const kicker = isGame ? 'Game Tomorrow' : eventType === 'practice' ? 'Practice Tomorrow' : 'Event Tomorrow';
  const whenText = endIso
    ? `${escape(fmtGameTime(startIso))} – ${escape(fmtGameTime(endIso))}`
    : escape(fmtGameTime(startIso));
  const intro = isGame
    ? 'quick heads-up that your next game is roughly 24 hours away. Tap below to RSVP, see the lineup, or pull up the rink directions.'
    : eventType === 'practice'
      ? "quick heads-up that practice is roughly 24 hours away. Tap below to RSVP or pull up directions."
      : "quick heads-up that this is roughly 24 hours away. Tap below to RSVP or pull up directions.";
  const ctaLabel = isGame ? 'Open Game →' : 'Open Schedule →';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#07111F;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px;">
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background:#0B1F3A;border-radius:12px;padding:16px 24px;">
        <span style="font-size:28px;font-weight:900;font-style:italic;color:#F4F7FA;letter-spacing:-0.5px;">R<span style="color:#D72638">INKD</span></span>
      </div>
    </div>
    <div style="background:#0B1F3A;border-radius:16px;padding:32px;margin-bottom:24px;border:1px solid rgba(46,91,140,0.4);">
      <div style="font-size:11px;font-weight:700;color:#D72638;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:6px;">${kicker}</div>
      <div style="font-size:24px;font-weight:900;font-style:italic;color:#F4F7FA;line-height:1.15;margin-bottom:14px;">${headline}</div>
      <div style="background:rgba(46,91,140,0.2);border-radius:8px;padding:14px 16px;margin-bottom:20px;">
        <div style="font-size:13px;color:rgba(244,247,250,0.55);margin-bottom:6px;">When</div>
        <div style="font-size:15px;font-weight:700;color:#F4F7FA;margin-bottom:12px;">${whenText}</div>
        ${location ? `
          <div style="font-size:13px;color:rgba(244,247,250,0.55);margin-bottom:6px;">Where</div>
          <div style="font-size:15px;font-weight:600;color:#F4F7FA;margin-bottom:${leagueName ? '12px' : '0'};">${escape(location)}</div>
        ` : ''}
        ${leagueName ? `
          <div style="font-size:13px;color:rgba(244,247,250,0.55);margin-bottom:6px;">League</div>
          <div style="font-size:15px;font-weight:600;color:#F4F7FA;">${escape(leagueName)}</div>
        ` : ''}
      </div>
      <div style="font-size:14px;color:rgba(244,247,250,0.6);line-height:1.6;margin-bottom:24px;">
        Hey ${escape(toName) || 'there'} — ${intro}
      </div>
      <a href="${escape(gameUrl)}" style="display:inline-block;background:#D72638;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 28px;border-radius:999px;">
        ${ctaLabel}
      </a>
    </div>
    <div style="text-align:center;font-size:12px;color:rgba(244,247,250,0.25);line-height:1.6;">
      You received this because you're on the roster for ${escape(teamName)}.<br>
      <a href="https://www.rinkd.app" style="color:rgba(244,247,250,0.4);">rinkd.app</a> ·
      <a href="https://www.rinkd.app/privacy" style="color:rgba(244,247,250,0.4);">Privacy</a>
    </div>
  </div>
</body></html>`;
}

type GameRow = {
  id: string;
  source: 'team' | 'league';
  start_iso: string;
  end_iso?: string | null;
  is_home: boolean;
  team_id: string;
  team_name: string;
  opponent_name: string;
  location: string;
  league_name?: string | null;
  event_type: 'game' | 'practice' | 'event';
  title?: string | null;
};

async function loadDueGames(supabase: ReturnType<typeof createClient>): Promise<GameRow[]> {
  // 24-25h window, hourly cron tolerant of ±30min drift.
  const now = Date.now();
  const start = new Date(now + 23.5 * 3600 * 1000).toISOString();
  const end = new Date(now + 25.5 * 3600 * 1000).toISOString();

  const games: GameRow[] = [];

  // --- TEAM GAMES (manager-scheduled, non-league) ---
  // Team schedule: games AND practices/events (event_type generalizes the row).
  const { data: teamGames, error: tgErr } = await supabase
    .from('team_games')
    .select(`
      id, start_time, end_time, is_home, opponent, location, team_id, status,
      event_type, title,
      rink:rink_id ( name, sub_rink, address ),
      team:team_id ( id, name )
    `)
    .gte('start_time', start)
    .lt('start_time', end)
    .neq('status', 'final')
    .neq('status', 'cancelled');

  if (tgErr) console.error('[reminders] team_games load error:', tgErr);
  for (const g of (teamGames ?? []) as any[]) {
    const rink = g.rink || {};
    const venueParts = [
      [rink.sub_rink, rink.name].filter(Boolean).join(' · '),
      rink.address,
      !rink.name ? g.location : null,
    ].filter(Boolean);
    const eventType = (g.event_type === 'practice' || g.event_type === 'event') ? g.event_type : 'game';
    games.push({
      id: g.id,
      source: 'team',
      start_iso: g.start_time,
      end_iso: g.end_time ?? null,
      is_home: !!g.is_home,
      team_id: g.team_id,
      team_name: g.team?.name ?? 'Your team',
      opponent_name: g.opponent ?? 'Opponent',
      location: venueParts.join(' — '),
      event_type: eventType,
      title: g.title ?? null,
    });
  }

  // --- LEAGUE GAMES (league-scheduled) ---
  const { data: leagueGames, error: lgErr } = await supabase
    .from('league_games')
    .select(`
      id, start_time, location, status, home_team_id, away_team_id,
      rink:rink_id ( name, sub_rink, address ),
      league:league_id ( id, name ),
      home_lt:home_team_id ( id, team_id, team_name, team:team_id ( id, name ) ),
      away_lt:away_team_id ( id, team_id, team_name, team:team_id ( id, name ) )
    `)
    .gte('start_time', start)
    .lt('start_time', end)
    .neq('status', 'final')
    .neq('status', 'cancelled');

  if (lgErr) console.error('[reminders] league_games load error:', lgErr);
  for (const g of (leagueGames ?? []) as any[]) {
    const rink = g.rink || {};
    const venueParts = [
      [rink.sub_rink, rink.name].filter(Boolean).join(' · '),
      rink.address,
      !rink.name ? g.location : null,
    ].filter(Boolean);
    const location = venueParts.join(' — ');

    // Two rows per league game — one for each side's roster.
    for (const side of [
      { isHome: true,  self: g.home_lt, opp: g.away_lt },
      { isHome: false, self: g.away_lt, opp: g.home_lt },
    ]) {
      const selfTeamId = side.self?.team?.id ?? side.self?.team_id;
      if (!selfTeamId) continue;
      games.push({
        id: g.id,
        source: 'league',
        start_iso: g.start_time,
        is_home: side.isHome,
        team_id: selfTeamId,
        team_name: side.self?.team?.name ?? side.self?.team_name ?? 'Your team',
        opponent_name: side.opp?.team?.name ?? side.opp?.team_name ?? 'Opponent',
        location,
        league_name: g.league?.name ?? null,
        event_type: 'game',
      });
    }
  }

  return games;
}

async function rosterEmails(supabase: ReturnType<typeof createClient>, teamId: string):
  Promise<Array<{ user_id: string; email: string; name: string }>> {
  const { data, error } = await supabase
    .from('team_members')
    .select('user_id, profile:user_id ( id, email, name )')
    .eq('team_id', teamId)
    .not('user_id', 'is', null);
  if (error) { console.error('[reminders] roster load error:', error); return []; }
  const out: Array<{ user_id: string; email: string; name: string }> = [];
  for (const m of (data ?? []) as any[]) {
    const p = m.profile;
    if (!p?.id || !p?.email) continue;
    out.push({ user_id: p.id, email: p.email, name: p.name ?? '' });
  }
  return out;
}

async function alreadySent(supabase: ReturnType<typeof createClient>, gameIds: string[]):
  Promise<Set<string>> {
  if (gameIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from('game_reminders_sent')
    .select('game_id, game_source, user_id, kind')
    .eq('kind', 'reminder_24h')
    .in('game_id', gameIds);
  if (error) { console.error('[reminders] ledger load error:', error); return new Set(); }
  const seen = new Set<string>();
  for (const r of (data ?? []) as any[]) seen.add(`${r.game_id}|${r.game_source}|${r.user_id}`);
  return seen;
}

async function sendOne(toEmail: string, subject: string, html: string): Promise<{ ok: boolean; id?: string; err?: any }> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [toEmail], subject, html }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, err: data };
  return { ok: true, id: data.id };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // Fail-closed bearer-token gate so only the pg_cron (which sends this header)
  // can fire this. If CRON_KEY is ever unset we DENY rather than run wide open
  // (the old `if (CRON_KEY)` form silently disabled auth when the var was unset).
  {
    const auth = req.headers.get('authorization') ?? '';
    if (!CRON_KEY || auth !== `Bearer ${CRON_KEY}`) {
      return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
  }

  const startedAt = Date.now();
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  try {
    const due = await loadDueGames(supabase);
    const ledger = await alreadySent(supabase, [...new Set(due.map(g => g.id))]);

    let attempted = 0;
    let sent = 0;
    let skippedDup = 0;
    let failed = 0;

    for (const game of due) {
      const roster = await rosterEmails(supabase, game.team_id);
      for (const player of roster) {
        const key = `${game.id}|${game.source}|${player.user_id}`;
        if (ledger.has(key)) { skippedDup++; continue; }

        attempted++;
        const isGame = game.event_type === 'game';
        const eventLabel = game.title || (game.event_type === 'practice' ? 'Practice' : 'Event');
        const subject = isGame
          ? `🏒 Tomorrow: ${game.team_name} ${game.is_home ? 'vs.' : '@'} ${game.opponent_name}`
          : `${game.event_type === 'practice' ? '🧊' : '📋'} Tomorrow: ${game.team_name} — ${eventLabel}`;
        // Games link to their game page; practices/events have no scoring page,
        // so link to the team's schedule.
        const gameUrl = !isGame
          ? `https://www.rinkd.app/team/${game.team_id}`
          : game.source === 'league'
            ? `https://www.rinkd.app/league-game/${game.id}`
            : `https://www.rinkd.app/team-game/${game.id}`;

        const html = emailHtml({
          toName: player.name,
          teamName: game.team_name,
          opponentName: game.opponent_name,
          isHome: game.is_home,
          startIso: game.start_iso,
          endIso: game.end_iso ?? null,
          location: game.location,
          gameUrl,
          leagueName: game.league_name ?? null,
          eventType: game.event_type,
          title: game.title ?? null,
        });

        const r = await sendOne(player.email, subject, html);
        if (r.ok) {
          sent++;
          ledger.add(key);
          await supabase.from('game_reminders_sent').insert({
            game_id: game.id,
            game_source: game.source,
            user_id: player.user_id,
            email: player.email,
            kind: 'reminder_24h',
            resend_id: r.id ?? null,
          });
        } else {
          failed++;
          console.error('[reminders] send fail', { game: game.id, user: player.user_id, err: r.err });
        }
      }
    }

    const body = {
      ok: true,
      due_games: due.length,
      attempted,
      sent,
      skipped_duplicate: skippedDup,
      failed,
      elapsed_ms: Date.now() - startedAt,
    };
    return new Response(JSON.stringify(body), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('[reminders] fatal', err);
    return new Response(JSON.stringify({ ok: false, error: String((err as Error)?.message || err) }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
