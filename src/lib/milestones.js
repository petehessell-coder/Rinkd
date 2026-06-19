// ENGAGE-1 — milestone client wrappers. All fail-safe: if the migration isn't
// applied yet, every call no-ops (returns []/undefined) so the profile + recap
// flow never break. Recognition stays scarce (gold) per the manifesto.
import { supabase } from './supabase';

const srcOf = (kind) => (kind === 'league' ? 'league' : 'tournament');

// A player's earned career moments, newest first. Public-read.
export async function getPlayerMilestones(userId) {
  if (!userId) return [];
  const { data, error } = await supabase.rpc('get_player_milestones', { p_user_id: userId });
  if (error) return [];
  return data || [];
}

// Detect + award milestones for a just-finalized game (idempotent, server-
// validated). Best-effort — a failure (e.g. RPC not deployed) is a silent
// no-op and must never block finalize.
export async function recordGameMilestones(gameId, kind) {
  if (!gameId) return;
  try {
    await supabase.rpc('award_milestones_for_game', { p_game_id: gameId, p_source: srcOf(kind) });
  } catch { /* not applied / transient — recognition is best-effort */ }
}

// Highest streak threshold the player has hit (0 if none) — for the identity header.
export function topStreak(milestones) {
  const vals = (milestones || []).filter((m) => m.kind === 'point_streak').map((m) => m.value);
  return vals.length ? Math.max(...vals) : 0;
}

// A one-line "season story" from the player's milestones (most impressive first).
export function seasonStory(milestones) {
  const ms = milestones || [];
  const streak = topStreak(ms);
  const hundred = ms.filter((m) => m.kind === 'points_100').map((m) => m.value);
  const bits = [];
  if (streak >= 3) bits.push(`${streak}-game point streak`);
  if (hundred.length) bits.push(`${Math.max(...hundred)} career points`);
  if (ms.some((m) => m.kind === 'first_goal')) bits.push('first goal in the books');
  return bits.length ? bits.join(' · ') : null;
}
