// SOCIAL-2 — GameSheet results poller (cron).
//
// For each ACTIVE gamesheet_links row on an ACTIVATED tournament:
//   1. Pull the season's games from GameSheet's public Firebase/Firestore backend
//      (their old getSeasonScores REST route was retired when they rebuilt the
//      public stats site on Next.js + Firestore — see fetchSeasonScores).
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
import { fetchSeasonScores } from './gamesheet-source.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_KEY = Deno.env.get('CRON_KEY') ?? '';

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

// The GameSheet data-source layer lives in ./gamesheet-source.ts (pure: fetch +
// Date only) so the edge fn and the Node test harness exercise the exact same
// fetchSeasonScores. It returns the legacy scored-game shape this file consumes.

// Build the recap headline, mirroring ScorerView's buildRecapContent shape.
function titleCase(s: string): string {
  return String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
// Goal scorers from the GameSheet recap[] (both teams), tallied "Name ×N".
// recap exposes scorer names only (no jersey/assists) — enough for a recap line.
function scorerSummary(g: any): string {
  const names: string[] = [];
  for (const team of [g?.homeTeam, g?.visitorTeam]) {
    for (const p of (team?.recap ?? [])) for (const e of (p?.events ?? [])) {
      if (e?.playerName) names.push(titleCase(e.playerName));
    }
  }
  if (!names.length) return '';
  const counts = new Map<string, number>(); const order: string[] = [];
  for (const n of names) { if (!counts.has(n)) order.push(n); counts.set(n, (counts.get(n) || 0) + 1); }
  const parts = order.map((n) => counts.get(n)! > 1 ? `${n} ×${counts.get(n)}` : n);
  return 'Goals: ' + parts.join(', ');
}

function recapContent(homeName: string, homeGoals: number, awayName: string, awayGoals: number, type: string | null, scorers = ''): string {
  const headline = `🏒 FINAL · ${homeName} ${homeGoals}, ${awayName} ${awayGoals}`;
  const isPlayoff = (type || '').toLowerCase().includes('playoff');
  const winner = homeGoals > awayGoals ? homeName : awayGoals > homeGoals ? awayName : null;
  const ctx = isPlayoff ? '🏆 Playoff' : 'Pool play';
  const winnerLine = isPlayoff && winner ? `\n${winner} advance.` : '';
  const scorerLine = scorers ? `\n${scorers}` : '';
  return `${headline}\n${ctx}${winnerLine}${scorerLine}`;
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

// Map a GameSheet game's free-text label/type to an allowed Rinkd round
// (games_round_check = pool|semifinal|final|consolation). Returns null for an
// ambiguous playoff game (quarterfinal / generic "Playoff") so the caller does
// NOT auto-import it with a bogus round — it queues as pending for the director.
// Order matters: "Semi-Final" must hit semi before final; "Quarterfinal" must
// not be read as a "final".
function mapGsRound(g: any): string | null {
  const label = `${g?.number ?? ''} ${g?.type ?? ''}`.toLowerCase();
  if (/bronze|consolation|3rd|third/.test(label)) return 'consolation';
  if (/semi/.test(label)) return 'semifinal';
  if (/quarter/.test(label)) return null;
  if (/final|championship|gold|cup/.test(label)) return 'final';
  if (label.includes('playoff')) return null;
  return 'pool';
}

// After a bracket game is written final from ANY source, advance the bracket
// and (on the turn the final matchup locks) post a "Final set" recap.
// Two bracket models coexist:
//   - General single-elim (BRACKET-GEN-2): the game carries bracket_round, so
//     advance_tournament_bracket propagates winners up the (round,slot) tree +
//     fills the 3rd-place game. Fires after ANY bracket game finalizes.
//   - Legacy 4-team-per-pool: bracket_round is null; resolve_tournament_bracket
//     pairs the two semis by pool. Unchanged so live/old brackets keep working.
async function maybeAdvanceBracket(supabase: Sb, link: any,
  g: { round: string | null; pool: string | null; division_id: string | null; bracket_round: number | null }): Promise<number> {
  if (g.bracket_round != null) {
    const { data, error } = await supabase.rpc('advance_tournament_bracket', {
      p_tournament_id: link.tournament_id, p_division_id: g.division_id ?? null,
    });
    if (error) { console.error('[gamesheet] bracket advance v2 fail', error); return 0; }
    const fm = (data as any)?.final_matchup;
    if (!fm?.game_id) return 0;
    await postRecapAndPush(supabase, {
      rinkdGameId: fm.game_id, tournamentId: link.tournament_id, directorId: link.director_id,
      content: `🏒 FINAL SET · ${fm.home} vs ${fm.away}\nThe championship matchup is locked.`,
    });
    return 1;
  }
  if (g.round !== 'semifinal' || !g.pool) return 0;
  const { data, error } = await supabase.rpc('resolve_tournament_bracket', {
    p_tournament_id: link.tournament_id, p_pool: g.pool, p_division_id: g.division_id ?? null,
  });
  if (error) { console.error('[gamesheet] bracket advance fail', error); return 0; }
  if (!data || !data.resolved || !data.final?.game_id) return 0;
  await postRecapAndPush(supabase, {
    rinkdGameId: data.final.game_id, tournamentId: link.tournament_id, directorId: link.director_id,
    content: `🏒 FINAL SET · ${data.final.home} vs ${data.final.away}\nThe championship matchup is locked.`,
  });
  return 1;
}

type RinkdGame = {
  id: string; division_id: string | null; status: string;
  home_score: number | null; away_score: number | null; start_time: string | null;
  home_name: string; away_name: string;
  round: string | null; pool: string | null; bracket_round: number | null;
};

async function loadRinkdGames(supabase: Sb, tournamentId: string, divisionId: string | null): Promise<RinkdGame[]> {
  let q = supabase.from('games')
    .select('id, division_id, status, home_score, away_score, start_time, round, pool, bracket_round, home_team:tournament_teams!home_team_id(team_name), away_team:tournament_teams!away_team_id(team_name)')
    .eq('tournament_id', tournamentId);
  if (divisionId) q = q.eq('division_id', divisionId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((g: any) => ({
    id: g.id, division_id: g.division_id, status: g.status,
    home_score: g.home_score, away_score: g.away_score, start_time: g.start_time,
    home_name: g.home_team?.team_name ?? '', away_name: g.away_team?.team_name ?? '',
    round: g.round ?? null, pool: g.pool ?? null, bracket_round: g.bracket_round ?? null,
  }));
}

async function syncLink(supabase: Sb, link: any): Promise<Record<string, number>> {
  const stats = { scored: 0, updated: 0, recaps: 0, pending: 0, unmatched: 0, imported: 0, skipped: 0 };
  const gsGames = await fetchSeasonScores(String(link.gamesheet_season_id));
  const rinkdGames = await loadRinkdGames(supabase, link.tournament_id, link.division_id);
  // Once a bracket exists, pool play is over — never auto-import a stray "pool"
  // game from an incoming playoff result. It either matches an existing bracket
  // slot (by team names, once advancement fills them) or queues pending for the
  // director. Pre-bracket pool play is unaffected (hasBracket is false then).
  const hasBracket = rinkdGames.some(r => r.bracket_round != null);

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
            content: recapContent(homeName, home, awayName, away, g.type, scorerSummary(g)),
          });
          stats.recaps++;
        }
        // Bracket advance: if this matched game belongs to a bracket, advance it
        // (general single-elim tree, or legacy 4-team pool). Works even though
        // ScorerView's client-side resolver never runs in external mode.
        stats.recaps += await maybeAdvanceBracket(supabase, link,
          { round: rg.round, pool: rg.pool, division_id: rg.division_id, bracket_round: rg.bracket_round });
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
    // mapGsRound returns null for an ambiguous playoff (quarterfinal / generic) —
    // don't fabricate a round (would violate games_round_check); fall through to a
    // pending row so the director can place it against a pre-built bracket.
    const importRound = (!matched && link.auto_import && !hasBracket) ? mapGsRound(g) : null;
    if (!matched && link.auto_import && !hasBracket && importRound !== null) {
      const homeId = await findOrCreateTeam(gHome);
      const awayId = await findOrCreateTeam(gAway);
      if (homeId && awayId) {
        const startIso = (() => { const t = Date.parse(`${g.date ?? ''} ${g.time ?? ''}`.trim()); return Number.isNaN(t) ? new Date().toISOString() : new Date(t).toISOString(); })();
        const round = importRound;
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
            content: recapContent(gHome, gHomeGoals, gAway, gAwayGoals, g.type, scorerSummary(g)),
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

// ===========================================================================
// LEAGUE PATH (GAMESHEET-LEAGUES-1) — ADDITIVE. A deliberate ~parallel copy of
// the tournament path above (syncLink / loadRinkdGames / findOrCreateTeam /
// postRecapAndPush). The two are intentionally NOT DRY'd together: the
// tournament path is a live, business-critical cron feeding real pilots, so the
// league support is built as a separate set of functions + a second links query
// in serve(). Same guardrails: exact-name (+within-1-day) fuzzy matches queue as
// `pending` for the commissioner to confirm; only `confirmed` maps + brand-new
// auto-imports ever write a score. Differences from the tournament path:
//   - writes to league_games (home_score/away_score/status='final'/end_time)
//   - recaps go through postLeagueRecapAndPush (recap_for_league_game_id)
//   - NO bracket advance (league playoffs use a different generator)
//   - auto-import lands as a regular_season game (no round ambiguity to gate on)

// Upsert one auto-recap per LEAGUE game (mirror of postRecapAndPush, keyed on
// recap_for_league_game_id) and fire the league recap push. Score-writing never
// blocks on the push (best-effort, errors swallowed).
async function postLeagueRecapAndPush(supabase: Sb, opts: {
  leagueGameId: string; leagueId: string; authorId: string | null; content: string;
}): Promise<void> {
  const { leagueGameId, leagueId, authorId, content } = opts;
  if (!authorId) return; // posts.author_id is required; no author → skip recap (score still written)
  const { data: existing } = await supabase
    .from('posts').select('id').eq('recap_for_league_game_id', leagueGameId).maybeSingle();
  let postId: string | null = null;
  if (existing) {
    postId = existing.id as string;
    await supabase.from('posts')
      .update({ content, tag: 'Game Recap', tag_color: '#2E5B8C', league_id: leagueId })
      .eq('id', postId);
  } else {
    const { data: ins, error } = await supabase.from('posts').insert({
      author_id: authorId, content, tag: 'Game Recap', tag_color: '#2E5B8C',
      recap_for_league_game_id: leagueGameId, league_id: leagueId,
      likes: 0, comment_count: 0, repost_count: 0, created_at: new Date().toISOString(),
    }).select('id').single();
    if (error) { console.error('[gamesheet] league recap insert fail', error); return; }
    postId = ins.id as string;
  }
  // Fire the league recap push (mirror of send-recap-push; walks post → league
  // game → league_subscriptions under service role). Service-role JWT satisfies verify_jwt.
  if (postId) {
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/send-league-recap-push`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: postId }),
      });
    } catch (e) { console.error('[gamesheet] league push invoke fail', e); }
  }
}

// Feed A2 — after the poller writes any league game final this run, diff the
// standings and auto-post positive movement ("climbed to 2nd" / "into 1st").
// One call per sync run (not per game): the snapshot diff yields each team's NET
// move after the batch, which is both cheaper and less spammy than per-game. The
// RPC is idempotent + advisory-locked, so it's safe alongside the native scorer.
// Service-role JWT; fail-soft — never blocks the score writes that already landed.
async function postLeagueStandingsMovement(supabase: Sb, leagueId: string, divisionId: string | null) {
  try {
    const { error } = await supabase.rpc('post_standings_movement', {
      p_league_id: leagueId, p_division_id: divisionId,
    });
    if (error) console.error('[gamesheet] standings movement fail', error);
  } catch (e) { console.error('[gamesheet] standings movement threw', e); }
}

type LeagueGame = {
  id: string; division_id: string | null; status: string;
  home_score: number | null; away_score: number | null; start_time: string | null;
  home_name: string; away_name: string;
  phase: string | null; round: string | null;
};

async function loadLeagueGames(supabase: Sb, leagueId: string, leagueDivisionId: string | null): Promise<LeagueGame[]> {
  let q = supabase.from('league_games')
    .select('id, division_id, status, home_score, away_score, start_time, phase, round, home_team:league_teams!home_team_id(team_name), away_team:league_teams!away_team_id(team_name)')
    .eq('league_id', leagueId);
  if (leagueDivisionId) q = q.eq('division_id', leagueDivisionId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((g: any) => ({
    id: g.id, division_id: g.division_id, status: g.status,
    home_score: g.home_score, away_score: g.away_score, start_time: g.start_time,
    home_name: g.home_team?.team_name ?? '', away_name: g.away_team?.team_name ?? '',
    phase: g.phase ?? null, round: g.round ?? null,
  }));
}

async function syncLeagueLink(supabase: Sb, link: any): Promise<Record<string, number>> {
  const stats = { scored: 0, updated: 0, recaps: 0, pending: 0, unmatched: 0, imported: 0, skipped: 0 };
  const gsGames = await fetchSeasonScores(String(link.gamesheet_season_id));
  const leagueGames = await loadLeagueGames(supabase, link.league_id, link.league_division_id);

  const { data: maps } = await supabase
    .from('gamesheet_game_map').select('*').eq('link_id', link.id);
  const mapByGs = new Map<string, any>();
  for (const m of (maps ?? [])) mapByGs.set(String(m.gamesheet_game_id), m);
  // League game ids already spoken for (any non-ignored map) → not re-matchable.
  const taken = new Set<string>();
  for (const m of (maps ?? [])) if (m.rinkd_game_id && m.status !== 'ignored') taken.add(m.rinkd_game_id);

  // For auto-import: find-or-create league_teams by normalized name so two
  // GameSheet games for the same team don't spawn duplicate Rinkd teams.
  const { data: teamRows } = await supabase
    .from('league_teams').select('id, team_name').eq('league_id', link.league_id);
  const teamByName = new Map<string, string>();
  for (const t of (teamRows ?? [])) teamByName.set(norm(t.team_name), t.id);
  async function findOrCreateLeagueTeam(name: string): Promise<string | null> {
    const key = norm(name);
    if (!key) return null;
    if (teamByName.has(key)) return teamByName.get(key)!;
    const { data, error } = await supabase.from('league_teams')
      .insert({ league_id: link.league_id, team_name: name, division_id: link.league_division_id || null, external_source: 'gamesheet' })
      .select('id').single();
    if (error || !data) { console.error('[gamesheet] league team create fail', name, error); return null; }
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

    // --- CONFIRMED: auto-write the score on the mapped league game ---
    if (existing && existing.status === 'confirmed' && existing.rinkd_game_id) {
      const rg = leagueGames.find(r => r.id === existing.rinkd_game_id);
      if (!rg) { stats.skipped++; continue; }
      // Resolve orientation by name so a GS-home/Rinkd-away flip is handled.
      const sameOrientation = norm(gHome) === norm(rg.home_name) || norm(gAway) === norm(rg.away_name);
      const home = sameOrientation ? gHomeGoals : gAwayGoals;
      const away = sameOrientation ? gAwayGoals : gHomeGoals;
      const wasFinal = rg.status === 'final';
      if (rg.home_score !== home || rg.away_score !== away || rg.status !== 'final') {
        const { error: ue } = await supabase.from('league_games')
          .update({ home_score: home, away_score: away, status: 'final', end_time: new Date().toISOString() }).eq('id', rg.id);
        if (ue) { console.error('[gamesheet] league score update fail', ue); stats.skipped++; continue; }
        stats.updated++;
        if (!wasFinal) {
          const homeName = sameOrientation ? gHome : gAway;
          const awayName = sameOrientation ? gAway : gHome;
          await postLeagueRecapAndPush(supabase, {
            leagueGameId: rg.id, leagueId: link.league_id, authorId: link.author_id,
            content: recapContent(homeName, home, awayName, away, g.type, scorerSummary(g)),
          });
          stats.recaps++;
        }
        // No bracket advance for leagues — league playoffs use a different
        // generator (single-round-at-a-time, no TBD placeholders to resolve).
      }
      await supabase.from('gamesheet_game_map')
        .update({ gs_home_goals: gHomeGoals, gs_visitor_goals: gAwayGoals, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      continue;
    }
    if (existing) { stats.skipped++; continue; } // pending (awaiting confirm) or ignored

    // --- NEW GS game: fuzzy-match → queue a PENDING row (never auto-write) ---
    const nH = norm(gHome), nA = norm(gAway);
    const candidates = leagueGames.filter(r => {
      if (taken.has(r.id)) return false;
      const rH = norm(r.home_name), rA = norm(r.away_name);
      const namesMatch = (nH === rH && nA === rA) || (nH === rA && nA === rH);
      return namesMatch && within1Day(gDate, isoDateKey(r.start_time));
    });
    const matched = candidates.length === 1 ? candidates[0] : null;

    // --- AUTO-IMPORT: no existing league game to match → create one. Safe to do
    // automatically (nothing to mis-match against), so it skips the confirm-once
    // step. Gated by the link's auto_import flag (off = leave as an unmatched
    // pending row for the commissioner to resolve against a pre-built schedule).
    // Unlike tournaments there's no bracket round to fabricate — league
    // auto-imports always land as regular_season games (round=null), so there's
    // no mapGsRound gate that could send a game to pending instead.
    if (!matched && link.auto_import) {
      const homeId = await findOrCreateLeagueTeam(gHome);
      const awayId = await findOrCreateLeagueTeam(gAway);
      if (homeId && awayId) {
        const startIso = (() => { const t = Date.parse(`${g.date ?? ''} ${g.time ?? ''}`.trim()); return Number.isNaN(t) ? new Date().toISOString() : new Date(t).toISOString(); })();
        const { data: ng, error: ge } = await supabase.from('league_games').insert({
          league_id: link.league_id, division_id: link.league_division_id || null,
          home_team_id: homeId, away_team_id: awayId,
          phase: 'regular_season', decided_in: 'regulation', round: null,
          status: 'final', start_time: startIso, end_time: new Date().toISOString(),
          home_score: gHomeGoals, away_score: gAwayGoals,
          external_source: 'gamesheet', external_id: gsId,
        }).select('id').single();
        if (!ge && ng) {
          await supabase.from('gamesheet_game_map').insert({
            link_id: link.id, rinkd_game_id: ng.id, gamesheet_game_id: gsId, status: 'confirmed',
            gs_home_name: gHome, gs_visitor_name: gAway, gs_division: g.homeTeam?.division ?? null,
            gs_date: g.date ?? null, gs_time: g.time ?? null, gs_home_goals: gHomeGoals, gs_visitor_goals: gAwayGoals,
          });
          await postLeagueRecapAndPush(supabase, {
            leagueGameId: ng.id, leagueId: link.league_id, authorId: link.author_id,
            content: recapContent(gHome, gHomeGoals, gAway, gAwayGoals, g.type, scorerSummary(g)),
          });
          stats.imported++; stats.recaps++;
          continue;
        }
        console.error('[gamesheet] league auto-import game create fail', ge);
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

  // Feed A2 — fire once if this run wrote any final that could move the table
  // (a fresh final OR a score correction on a confirmed game → stats.updated;
  // an auto-import → stats.imported). Scoped to the link's division (null = whole
  // league). Fail-soft inside the helper.
  if (stats.updated > 0 || stats.imported > 0) {
    await postLeagueStandingsMovement(supabase, link.league_id, link.league_division_id ?? null);
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

    // --- LEAGUE links (GAMESHEET-LEAGUES-1) — second, disjoint pass. The
    // tournament query above uses tournaments!inner, so a league-owned link
    // (tournament_id NULL) never appears in it; this query uses leagues!inner +
    // a not-null league_id, so a tournament-owned link never appears here. Active
    // links on ACTIVATED leagues only (moat-consistent). commissioner_id is the
    // recap author (the director_id analog). A failure here is logged but does
    // NOT abort the function — the tournament writes above already committed. ---
    const { data: leagueLinks, error: lErr } = await supabase
      .from('gamesheet_links')
      .select('id, league_id, league_division_id, gamesheet_season_id, auto_import, leagues!inner(commissioner_id, is_activated)')
      .eq('status', 'active')
      .not('league_id', 'is', null)
      .eq('leagues.is_activated', true);
    if (lErr) console.error('[gamesheet] league links query fail', lErr);

    for (const raw of (leagueLinks ?? [])) {
      const link = { ...raw, author_id: (raw as any).leagues?.commissioner_id ?? null };
      totals.links++;
      try {
        const s = await syncLeagueLink(supabase, link);
        totals.scored += s.scored; totals.updated += s.updated; totals.imported += s.imported; totals.recaps += s.recaps;
        totals.pending += s.pending; totals.unmatched += s.unmatched;
      } catch (e) {
        totals.errors++;
        console.error('[gamesheet] league link sync fail', link.id, e);
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
