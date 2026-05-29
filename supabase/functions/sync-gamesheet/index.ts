// SOCIAL-2 — GameSheet results poller (cron).
//
// For each ACTIVE gamesheet_links row on an ACTIVATED tournament:
//   1. Pull the season's scored games from GameSheet's public JSON API.
//   2. CONFIRMED map rows (stable gameId ↔ rinkd game) → auto-write the score;
//      on the first flip to final, post a recap + fire the push.
//   3. Unseen GameSheet games → fuzzy-match by team names (+ date) and queue a
//      PENDING map row for one-tap admin confirm. Never auto-writes a fuzzy
//      match (guards against scoring the wrong game).
//
// All lookups + writes use the service role (RLS bypassed). The poller only
// touches events that have an active link AND is_activated=true (moat-consistent
// with the push functions). Inert for every other event — including BLPA.
//
// Trigger via pg_cron (every 3 min during event windows is plenty):
//   select cron.schedule('rinkd-gamesheet-sync','*/3 * * * *',
//     $$ select net.http_post(
//          url:='https://tbpoopsyhfuqcbugrjbh.supabase.co/functions/v1/sync-gamesheet',
//          headers:=jsonb_build_object('Authorization','Bearer '||current_setting('app.cron_key'))
//        ) $$);

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_KEY = Deno.env.get('CRON_KEY') ?? '';
const GS_BASE = 'https://gamesheetstats.com';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Sb = ReturnType<typeof createClient>;

// Normalize a team name for fuzzy matching: lowercase, drop punctuation,
// collapse whitespace. "MARNG REDLEGS" === "Marng Redlegs".
function norm(s: string | null | undefined): string {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// GameSheet display date "Jun 8, 2025" → "2025-06-08" (best-effort, for
// same-day disambiguation only). Returns '' if unparseable.
function gsDateKey(d: string | null | undefined): string {
  if (!d) return '';
  const t = Date.parse(d);
  if (Number.isNaN(t)) return '';
  return new Date(t).toISOString().slice(0, 10);
}
// Rinkd ISO start_time → "YYYY-MM-DD" in UTC (loose ±1 day comparison absorbs tz skew).
function isoDateKey(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Date(t).toISOString().slice(0, 10);
}
function within1Day(a: string, b: string): boolean {
  if (!a || !b) return true; // missing date on either side → don't block the match
  const ta = Date.parse(a + 'T00:00:00Z'), tb = Date.parse(b + 'T00:00:00Z');
  if (Number.isNaN(ta) || Number.isNaN(tb)) return true;
  return Math.abs(ta - tb) <= 24 * 3600 * 1000;
}

async function fetchSeasonScores(seasonId: string): Promise<any[]> {
  const res = await fetch(`${GS_BASE}/api/useScoredGames/getSeasonScores/${encodeURIComponent(seasonId)}`, {
    headers: { 'User-Agent': 'RinkdSync/1.0 (+https://rinkd.app)', 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`getSeasonScores ${seasonId} → HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// Build the recap headline, mirroring ScorerView's buildRecapContent shape.
function recapContent(homeName: string, homeGoals: number, awayName: string, awayGoals: number, type: string | null): string {
  const headline = `🏒 FINAL · ${homeName} ${homeGoals}, ${awayName} ${awayGoals}`;
  const isPlayoff = (type || '').toLowerCase().includes('playoff');
  const winner = homeGoals > awayGoals ? homeName : awayGoals > homeGoals ? awayName : null;
  const ctx = isPlayoff ? '🏆 Playoff' : 'Pool play';
  const winnerLine = isPlayoff && winner ? `\n${winner} advance.` : '';
  return `${headline}\n${ctx}${winnerLine}`;
}

async function postRecapAndPush(supabase: Sb, opts: {
  rinkdGameId: string; tournamentId: string; directorId: string | null; content: string;
}): Promise<void> {
  const { rinkdGameId, tournamentId, directorId, content } = opts;
  if (!directorId) return; // posts.author_id is required; no author → skip recap (score still written)
  // Upsert on the partial unique index (one recap per game). Mirror of
  // lib/posts.js createGameRecapPost: keep the original author on re-finalize.
  const { data: existing } = await supabase
    .from('posts').select('id').eq('recap_for_game_id', rinkdGameId).maybeSingle();
  let postId: string | null = null;
  if (existing) {
    postId = existing.id as string;
    await supabase.from('posts')
      .update({ content, tag: 'Game Recap', tag_color: '#2E5B8C', tournament_id: tournamentId })
      .eq('id', postId);
  } else {
    const { data: ins, error } = await supabase.from('posts').insert({
      author_id: directorId, content, tag: 'Game Recap', tag_color: '#2E5B8C',
      recap_for_game_id: rinkdGameId, tournament_id: tournamentId,
      likes: 0, comment_count: 0, repost_count: 0, created_at: new Date().toISOString(),
    }).select('id').single();
    if (error) { console.error('[gamesheet] recap insert fail', error); return; }
    postId = ins.id as string;
  }
  // Fire the existing tournament recap push (service-role JWT satisfies verify_jwt).
  if (postId) {
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/send-recap-push`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: postId }),
      });
    } catch (e) { console.error('[gamesheet] push invoke fail', e); }
  }
}

type RinkdGame = {
  id: string; division_id: string | null; status: string;
  home_score: number | null; away_score: number | null; start_time: string | null;
  home_name: string; away_name: string;
};

async function loadRinkdGames(supabase: Sb, tournamentId: string, divisionId: string | null): Promise<RinkdGame[]> {
  let q = supabase.from('games')
    .select('id, division_id, status, home_score, away_score, start_time, home_team:tournament_teams!home_team_id(team_name), away_team:tournament_teams!away_team_id(team_name)')
    .eq('tournament_id', tournamentId);
  if (divisionId) q = q.eq('division_id', divisionId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((g: any) => ({
    id: g.id, division_id: g.division_id, status: g.status,
    home_score: g.home_score, away_score: g.away_score, start_time: g.start_time,
    home_name: g.home_team?.team_name ?? '', away_name: g.away_team?.team_name ?? '',
  }));
}

async function syncLink(supabase: Sb, link: any): Promise<Record<string, number>> {
  const stats = { scored: 0, updated: 0, recaps: 0, pending: 0, unmatched: 0, imported: 0, skipped: 0 };
  const gsGames = await fetchSeasonScores(String(link.gamesheet_season_id));
  const rinkdGames = await loadRinkdGames(supabase, link.tournament_id, link.division_id);

  const { data: maps } = await supabase
    .from('gamesheet_game_map').select('*').eq('link_id', link.id);
  const mapByGs = new Map<string, any>();
  for (const m of (maps ?? [])) mapByGs.set(String(m.gamesheet_game_id), m);
  // Rinkd game ids already spoken for (any non-ignored map) → not re-matchable.
  const taken = new Set<string>();
  for (const m of (maps ?? [])) if (m.rinkd_game_id && m.status !== 'ignored') taken.add(m.rinkd_game_id);

  // For auto-import: find-or-create tournament_teams by normalized name so two
  // GameSheet games for the same team don't spawn duplicate Rinkd teams.
  const { data: teamRows } = await supabase
    .from('tournament_teams').select('id, team_name').eq('tournament_id', link.tournament_id);
  const teamByName = new Map<string, string>();
  for (const t of (teamRows ?? [])) teamByName.set(norm(t.team_name), t.id);
  async function findOrCreateTeam(name: string): Promise<string | null> {
    const key = norm(name);
    if (!key) return null;
    if (teamByName.has(key)) return teamByName.get(key)!;
    // NB: tournament_teams.pool is NOT NULL (default 'A') — omit it so the
    // default applies (GameSheet doesn't expose a pool).
    const { data, error } = await supabase.from('tournament_teams')
      .insert({ tournament_id: link.tournament_id, division_id: link.division_id || null, team_name: name })
      .select('id').single();
    if (error || !data) { console.error('[gamesheet] team create fail', name, error); return null; }
    teamByName.set(key, data.id);
    return data.id as string;
  }

  for (const entry of gsGames) {
    const g = entry?.game;
    if (!g || !g.gameId || !g.finalScore) { continue; }
    stats.scored++;
    const gsId = String(g.gameId);
    const gHome = g.homeTeam?.name ?? '', gAway = g.visitorTeam?.name ?? '';
    const gHomeGoals = Number(g.finalScore.homeGoals ?? 0), gAwayGoals = Number(g.finalScore.visitorGoals ?? 0);
    const gDate = gsDateKey(g.date);
    const existing = mapByGs.get(gsId);

    // --- CONFIRMED: auto-write the score on the mapped Rinkd game ---
    if (existing && existing.status === 'confirmed' && existing.rinkd_game_id) {
      const rg = rinkdGames.find(r => r.id === existing.rinkd_game_id);
      if (!rg) { stats.skipped++; continue; }
      // Resolve orientation by name so a GS-home/Rinkd-away flip is handled.
      const sameOrientation = norm(gHome) === norm(rg.home_name) || norm(gAway) === norm(rg.away_name);
      const home = sameOrientation ? gHomeGoals : gAwayGoals;
      const away = sameOrientation ? gAwayGoals : gHomeGoals;
      const wasFinal = rg.status === 'final';
      if (rg.home_score !== home || rg.away_score !== away || rg.status !== 'final') {
        const { error: ue } = await supabase.from('games')
          .update({ home_score: home, away_score: away, status: 'final' }).eq('id', rg.id);
        if (ue) { console.error('[gamesheet] score update fail', ue); stats.skipped++; continue; }
        stats.updated++;
        if (!wasFinal) {
          const homeName = sameOrientation ? gHome : gAway;
          const awayName = sameOrientation ? gAway : gHome;
          await postRecapAndPush(supabase, {
            rinkdGameId: rg.id, tournamentId: link.tournament_id, directorId: link.director_id,
            content: recapContent(homeName, home, awayName, away, g.type),
          });
          stats.recaps++;
        }
      }
      await supabase.from('gamesheet_game_map')
        .update({ gs_home_goals: gHomeGoals, gs_visitor_goals: gAwayGoals, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      continue;
    }
    if (existing) { stats.skipped++; continue; } // pending (awaiting confirm) or ignored

    // --- NEW GS game: fuzzy-match → queue a PENDING row (never auto-write) ---
    const nH = norm(gHome), nA = norm(gAway);
    const candidates = rinkdGames.filter(r => {
      if (taken.has(r.id)) return false;
      const rH = norm(r.home_name), rA = norm(r.away_name);
      const namesMatch = (nH === rH && nA === rA) || (nH === rA && nA === rH);
      return namesMatch && within1Day(gDate, isoDateKey(r.start_time));
    });
    const matched = candidates.length === 1 ? candidates[0] : null;

    // --- AUTO-IMPORT: no existing Rinkd game to match → create one. Safe to do
    // automatically (nothing to mis-match against), so it skips the confirm-once
    // step. Gated by the link's auto_import flag (off = leave as an unmatched
    // pending row for the director to resolve against a pre-built schedule). ---
    if (!matched && link.auto_import) {
      const homeId = await findOrCreateTeam(gHome);
      const awayId = await findOrCreateTeam(gAway);
      if (homeId && awayId) {
        const startIso = (() => { const t = Date.parse(`${g.date ?? ''} ${g.time ?? ''}`.trim()); return Number.isNaN(t) ? new Date().toISOString() : new Date(t).toISOString(); })();
        const round = String(g.type ?? '').toLowerCase().includes('playoff') ? 'playoff' : 'pool';
        const { data: ng, error: ge } = await supabase.from('games').insert({
          tournament_id: link.tournament_id, division_id: link.division_id || null,
          home_team_id: homeId, away_team_id: awayId, pool: null, round,
          status: 'final', start_time: startIso, home_score: gHomeGoals, away_score: gAwayGoals,
        }).select('id').single();
        if (!ge && ng) {
          await supabase.from('gamesheet_game_map').insert({
            link_id: link.id, rinkd_game_id: ng.id, gamesheet_game_id: gsId, status: 'confirmed',
            gs_home_name: gHome, gs_visitor_name: gAway, gs_division: g.homeTeam?.division ?? null,
            gs_date: g.date ?? null, gs_time: g.time ?? null, gs_home_goals: gHomeGoals, gs_visitor_goals: gAwayGoals,
          });
          await postRecapAndPush(supabase, {
            rinkdGameId: ng.id, tournamentId: link.tournament_id, directorId: link.director_id,
            content: recapContent(gHome, gHomeGoals, gAway, gAwayGoals, g.type),
          });
          stats.imported++; stats.recaps++;
          continue;
        }
        console.error('[gamesheet] auto-import game create fail', ge);
      }
      // fell through (team/game create failed) → record as unmatched pending below
    }

    if (matched) { taken.add(matched.id); stats.pending++; } else { stats.unmatched++; }
    await supabase.from('gamesheet_game_map').insert({
      link_id: link.id, rinkd_game_id: matched?.id ?? null, gamesheet_game_id: gsId, status: 'pending',
      gs_home_name: gHome, gs_visitor_name: gAway, gs_division: g.homeTeam?.division ?? null,
      gs_date: g.date ?? null, gs_time: g.time ?? null,
      gs_home_goals: gHomeGoals, gs_visitor_goals: gAwayGoals,
    });
  }

  const note = `scored=${stats.scored} updated=${stats.updated} imported=${stats.imported} recaps=${stats.recaps} pending=${stats.pending} unmatched=${stats.unmatched}`;
  await supabase.from('gamesheet_links')
    .update({ last_synced_at: new Date().toISOString(), last_sync_note: note }).eq('id', link.id);
  return stats;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (CRON_KEY) {
    const auth = req.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${CRON_KEY}`) {
      return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
  }
  const startedAt = Date.now();
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  try {
    // Active links on ACTIVATED tournaments only (moat-consistent). Pull the
    // director_id alongside so recap posts have an author.
    const { data: links, error } = await supabase
      .from('gamesheet_links')
      .select('id, tournament_id, division_id, gamesheet_season_id, auto_import, tournaments!inner(director_id, is_activated)')
      .eq('status', 'active')
      .eq('tournaments.is_activated', true);
    if (error) throw error;

    const totals = { links: 0, scored: 0, updated: 0, imported: 0, recaps: 0, pending: 0, unmatched: 0, errors: 0 };
    for (const raw of (links ?? [])) {
      const link = { ...raw, director_id: (raw as any).tournaments?.director_id ?? null };
      totals.links++;
      try {
        const s = await syncLink(supabase, link);
        totals.scored += s.scored; totals.updated += s.updated; totals.imported += s.imported; totals.recaps += s.recaps;
        totals.pending += s.pending; totals.unmatched += s.unmatched;
      } catch (e) {
        totals.errors++;
        console.error('[gamesheet] link sync fail', link.id, e);
        await supabase.from('gamesheet_links')
          .update({ last_synced_at: new Date().toISOString(), last_sync_note: `error: ${String((e as Error)?.message || e)}` })
          .eq('id', link.id);
      }
    }
    return new Response(JSON.stringify({ ok: true, ...totals, elapsed_ms: Date.now() - startedAt }),
      { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('[gamesheet] fatal', err);
    return new Response(JSON.stringify({ ok: false, error: String((err as Error)?.message || err) }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
