import { supabase } from './supabase';

/**
 * Game lineups record who actually played in a specific game on a specific team.
 *
 * Why this table exists: without it, every player's GP (games played) on a
 * team inflates to "every final game the team played", which is wrong for
 * mid-season call-ups and players who skipped a game. With lineups, GP =
 * count of finalized games this exact player appeared on the lineup for.
 *
 * One row per (game_id, team_id, jersey_number).
 */

// ── Reads ──────────────────────────────────────────────────────────────────

export async function getLineup(gameId, teamId) {
  const { data, error } = await supabase
    .from('game_lineups')
    .select('*')
    .eq('game_id', gameId)
    .eq('team_id', teamId)
    .order('jersey_number');
  if (error) throw error;
  return data || [];
}

export async function listGamesForUserLineups(userId) {
  // Used by stats to compute roster-aware GP.
  const { data, error } = await supabase
    .from('game_lineups')
    .select('game_id, game_source, team_id, jersey_number')
    .eq('user_id', userId);
  if (error) throw error;
  return data || [];
}

// ── Writes ─────────────────────────────────────────────────────────────────

/**
 * Replace the lineup for a (game, team). Wipes existing rows and inserts the
 * new set in one go. Atomic enough for our needs.
 *
 * @param {object} ctx     — { gameId, gameSource, teamId }
 * @param {Array}  players — array of { user_id?, player_id?, invite_name?, jersey_number, position?, is_captain?, is_alternate?, is_goalie?, is_starter?, line? }
 *
 * `line` semantics (mirrors the game_lineups.line column comment):
 * forwards L1–L4, defense D-pair 1–3, goalies 1 = starter / 2 = backup.
 */
export async function setLineup(ctx, players) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in required.');
  const { gameId, gameSource, teamId } = ctx;
  if (!gameId || !teamId || !gameSource) throw new Error('Missing game or team context.');

  const rows = (players || []).map(p => ({
    user_id: p.user_id || null,
    // Identity resolved at save time when the roster row carries one; ghost
    // rows stay null here and resolveLineupPlayers() jersey-matches them.
    player_id: p.player_id || p.user_id || null,
    invite_name: p.invite_name || null,
    jersey_number: p.jersey_number != null ? p.jersey_number : null,
    position: p.position || null,
    is_captain: !!p.is_captain,
    is_alternate: !!p.is_alternate,
    is_goalie: !!p.is_goalie,
    is_starter: p.is_starter !== false,
    line: p.line != null ? p.line : null,
  }));

  // Server-side transactional replace: a failed insert (duplicate jersey,
  // minor gate) rolls the wipe back, so the saved lineup survives. The old
  // delete-then-insert from the client could commit the delete and then fail
  // the insert, silently erasing the lineup.
  const { data, error } = await supabase.rpc('set_lineup', {
    p_game_id: gameId,
    p_game_source: gameSource,
    p_team_id: teamId,
    p_players: rows,
  });
  if (error) throw error;
  return data || [];
}

/**
 * GS-5 resolver: attribute this game's lineup rows to real profiles via the
 * REG roster (team_members). Server-side RPC; collisions (one jersey worn by
 * two rostered identities) stay unresolved on purpose. Best-effort by design —
 * a failed resolution must never fail the save that triggered it.
 */
export async function resolveLineupPlayers(gameId) {
  try {
    const { data, error } = await supabase.rpc('resolve_lineup_players', { p_game_id: gameId });
    if (error) return 0;
    return data || 0;
  } catch {
    return 0;
  }
}

// ── P4: tonight's-lines post ────────────────────────────────────────────────

/**
 * Render the "tonight's lines" post body from the lineup the coach just
 * saved. Pure function — testable, and the single place the post format
 * lives.
 *
 * Privacy posture (audited Jun 12): names appear exactly as the roster
 * already displays them; NO profile ids, @mentions, or links — a minor's
 * stable id stays shielded (Migration I posture) while their name is the
 * same consented roster exposure as team_members/game_lineups.
 *
 * @param {string} gameTitle — display line ("Ice Hogs vs. Polar Kings · Fri Jun 13")
 * @param {Array} goalies/defense/forwards — dressed players: { name, jersey, line }
 *   line semantics per group: goalies 1=starter/2=backup, defense pairs 1–3,
 *   forwards L1–L4. NULL line = dressed, unassigned (omitted from the post).
 * @param {Array} subs — day-of pulls: { name, jersey }
 * @returns {string|null} — null when there's nothing line-shaped to post
 *   (no starter, no assignments): the caller should disable/skip posting.
 */
export function buildLinesPostContent({ gameTitle, goalies = [], defense = [], forwards = [], subs = [] }) {
  const tagName = (p) => p.jersey != null && p.jersey !== '' ? `${p.name} (#${p.jersey})` : p.name;
  const group = (list, n) => list.filter(p => p.line === n).map(tagName).join(' · ');

  // Starter: the designated net (line 1), else a lone dressed goalie.
  const starter = goalies.find(g => g.line === 1) || (goalies.length === 1 ? goalies[0] : null);

  const rows = [];
  if (starter) rows.push(`🥅 Starting: ${tagName(starter)}`);
  for (let n = 1; n <= 4; n++) {
    const line = group(forwards, n);
    if (line) rows.push(`L${n}: ${line}`);
  }
  for (let n = 1; n <= 3; n++) {
    const pair = group(defense, n);
    if (pair) rows.push(`D${n}: ${pair}`);
  }
  if (rows.length === 0) return null; // dressing-only saves have no lines story
  if (subs.length > 0) rows.push(`Subs tonight: ${subs.map(tagName).join(' · ')}`);

  return [`📋 TONIGHT'S LINES`, gameTitle || null, '', ...rows].filter(s => s !== null).join('\n');
}

/**
 * Create-or-refresh the lines post on the team's feed. Server-side RPC owns
 * idempotency (one post per game+team — re-finalize updates, never
 * double-posts), authorization (manager/coach, fail-closed), and scoping
 * (always the backing team's feed; never the global/league/tournament feed).
 * Direct write on purpose — line-setting is the manager-at-home flow (P1
 * decision), so this posts directly too, not through queuedWrite.
 *
 * @param {object} args — { gameId, gameSource ('league'|'team'), teamId
 *   (the LINEUP-scope id: league_teams.id for league games, teams.id for
 *   team games — same id game_lineups carries), content }
 * @returns the posts row.
 */
export async function upsertLineupPost({ gameId, gameSource, teamId, content }) {
  const { data, error } = await supabase.rpc('upsert_lineup_post', {
    p_game_id: gameId,
    p_game_source: gameSource,
    p_team_id: teamId,
    p_content: content,
  });
  if (error) throw error;
  return data;
}

/**
 * Fan the "lines are up" push out to the team's roster (send-sub-alert
 * posture: post first, push amplifies). Best-effort — the post is the
 * record, a push failure must never surface as a save failure.
 */
export async function sendLineupPostPush(postId) {
  try {
    const { error } = await supabase.functions.invoke('send-lines-alert', {
      body: { post_id: postId },
    });
    return !error;
  } catch {
    return false;
  }
}
