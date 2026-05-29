import { supabase } from './supabase';

/**
 * MULTIDIV-1 Phase 2 — eligibility flags (ADVISORY ONLY; never blocks puck drop).
 * All flags are computed from existing per-game lineup rows — Rinkd's tournament
 * player model is jersey-keyed (no first-class roster table), so a "player" is
 * (team_id, jersey_number) within a division.
 *
 * Flags:
 *  - no_prelim   : appears in a playoff (non-pool) lineup but never played a pool game for their team.
 *  - post_freeze : first lineup appearance is after the division's roster_frozen_at.
 *  - no_usah     : missing a USA Hockey # — only surfaced once SOME lineup in the
 *                  division has one filled (otherwise it'd flag everyone = noise).
 */

const isPool = (round) => !round || round === 'pool';

export async function setRosterFreeze(divisionId, frozen) {
  const { error } = await supabase
    .from('tournament_divisions')
    .update({ roster_frozen_at: frozen ? new Date().toISOString() : null })
    .eq('id', divisionId);
  return { error };
}

export async function computeEligibilityFlags(tournamentId, divisionId, rosterFrozenAt = null) {
  // 1. Division's games (id + round). Scope to the division when given.
  let gq = supabase.from('games').select('id, round, division_id').eq('tournament_id', tournamentId);
  if (divisionId) gq = gq.eq('division_id', divisionId);
  const { data: games, error: ge } = await gq;
  if (ge) return { flags: [], error: ge };
  const gameIds = (games || []).map(g => g.id);
  if (gameIds.length === 0) return { flags: [], error: null };
  const roundByGame = {};
  for (const g of games) roundByGame[g.id] = g.round;

  // 2. Lineups for those games + team names.
  const [{ data: lineups, error: le }, { data: teams }] = await Promise.all([
    supabase.from('game_lineups')
      .select('game_id, team_id, user_id, invite_name, jersey_number, usa_hockey_number, created_at')
      .in('game_id', gameIds),
    supabase.from('tournament_teams').select('id, team_name').eq('tournament_id', tournamentId),
  ]);
  if (le) return { flags: [], error: le };
  const teamName = {};
  for (const t of (teams || [])) teamName[t.id] = t.team_name;

  // 3. Index appearances by (team, jersey).
  const players = new Map(); // key → { team_id, jersey, name, playedPool, playedPlayoff, firstSeen, hasUsah }
  let anyUsah = false;
  for (const l of (lineups || [])) {
    if (l.jersey_number == null || !l.team_id) continue;
    const key = `${l.team_id}::${l.jersey_number}`;
    let p = players.get(key);
    if (!p) { p = { team_id: l.team_id, jersey: l.jersey_number, name: null, playedPool: false, playedPlayoff: false, firstSeen: l.created_at, hasUsah: false }; players.set(key, p); }
    if (!p.name && l.invite_name) p.name = l.invite_name;
    if (isPool(roundByGame[l.game_id])) p.playedPool = true; else p.playedPlayoff = true;
    if (l.created_at && (!p.firstSeen || l.created_at < p.firstSeen)) p.firstSeen = l.created_at;
    if (l.usa_hockey_number && String(l.usa_hockey_number).trim()) { p.hasUsah = true; anyUsah = true; }
  }

  // 4. Derive flags.
  const flags = [];
  const label = (p) => `${p.name ? p.name + ' ' : ''}#${p.jersey} · ${teamName[p.team_id] || 'Unknown team'}`;
  for (const p of players.values()) {
    if (p.playedPlayoff && !p.playedPool) {
      flags.push({ kind: 'no_prelim', key: `${p.team_id}:${p.jersey}`, message: `${label(p)} — in a playoff lineup but played no prelim game` });
    }
    if (rosterFrozenAt && p.firstSeen && p.firstSeen > rosterFrozenAt) {
      flags.push({ kind: 'post_freeze', key: `${p.team_id}:${p.jersey}`, message: `${label(p)} — added after the roster freeze` });
    }
    if (anyUsah && !p.hasUsah) {
      flags.push({ kind: 'no_usah', key: `${p.team_id}:${p.jersey}`, message: `${label(p)} — no USA Hockey #` });
    }
  }
  return { flags, error: null };
}
