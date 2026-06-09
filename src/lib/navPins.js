import { supabase } from './supabase';

// NAV-PIN-2 — the user's explicit nav pins (up to 3: one league, one team, one
// tournament). v1 auto-derived a single league; v2 is fully user-chosen via the
// 📌 toggle on each page. Tournament pins expire 7 days after the event (the
// server sets expires_at; we also filter on read so an expired one never shows).

// Display columns per type. Tournaments have no logo_initials/logo_color, so we
// derive initials from the name and use accent_color for the avatar background.
const LEAGUE_COLS = 'id, name, logo_url, accent_color, logo_color, logo_initials';
const TEAM_COLS = 'id, name, logo_url, logo_color, logo_initials';
const TOURNAMENT_COLS = 'id, name, logo_url, accent_color';

// Module-level session cache — Layout mounts its own <NavPins> and remounts per
// route, so without this it would re-query on every navigation. Pins change
// rarely; mutations (setNavPin/clearNavPin) clear the cache, and a hard reload
// re-derives.
let _cache = { key: null, value: null, loaded: false };
export function clearNavPinsCache() { _cache = { key: null, value: null, loaded: false }; }

const hrefFor = (type, id) =>
  type === 'league' ? `/league/${id}` : type === 'team' ? `/team/${id}` : `/tournament/${id}`;

// The user's active pins, hydrated for rendering:
//   { pin_type, target_id, name, logo_url, bg, initials, href }
// Ordered by created_at (pin order). Expired tournament pins are dropped.
export async function getMyNavPins(userId, { force = false } = {}) {
  if (!userId) return [];
  if (!force && _cache.loaded && _cache.key === userId) return _cache.value;
  let out = [];
  try {
    const nowIso = new Date().toISOString();
    const { data: pins } = await supabase
      .from('nav_pins')
      .select('pin_type, target_id, expires_at, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    const active = (pins || []).filter((p) => !p.expires_at || p.expires_at > nowIso);
    if (!active.length) { _cache = { key: userId, value: [], loaded: true }; return []; }

    const ids = { league: [], team: [], tournament: [] };
    active.forEach((p) => { if (ids[p.pin_type]) ids[p.pin_type].push(p.target_id); });
    const [lg, tm, tr] = await Promise.all([
      ids.league.length ? supabase.from('leagues').select(LEAGUE_COLS).in('id', ids.league) : Promise.resolve({ data: [] }),
      ids.team.length ? supabase.from('teams').select(TEAM_COLS).in('id', ids.team) : Promise.resolve({ data: [] }),
      ids.tournament.length ? supabase.from('tournaments').select(TOURNAMENT_COLS).in('id', ids.tournament) : Promise.resolve({ data: [] }),
    ]);
    const maps = {
      league: new Map((lg.data || []).map((x) => [x.id, x])),
      team: new Map((tm.data || []).map((x) => [x.id, x])),
      tournament: new Map((tr.data || []).map((x) => [x.id, x])),
    };
    out = active.map((p) => {
      const rec = maps[p.pin_type]?.get(p.target_id);
      if (!rec) return null; // target deleted → drop the stale pin
      const initials = rec.logo_initials || (rec.name ? rec.name.trim().charAt(0).toUpperCase() : '?');
      const bg = rec.accent_color || rec.logo_color || '#2E5B8C';
      return { pin_type: p.pin_type, target_id: p.target_id, name: rec.name, logo_url: rec.logo_url, bg, initials, href: hrefFor(p.pin_type, p.target_id) };
    }).filter(Boolean);
  } catch { out = []; }
  _cache = { key: userId, value: out, loaded: true };
  return out;
}

export async function isPinned(userId, pinType, targetId) {
  if (!userId || !targetId) return false;
  const pins = await getMyNavPins(userId);
  return pins.some((p) => p.pin_type === pinType && p.target_id === targetId);
}

// Pin (or re-pin — swaps the existing pin of that type). Server computes the
// tournament expiry. Clears the cache so the nav refreshes.
export async function setNavPin(pinType, targetId) {
  const { error } = await supabase.rpc('set_nav_pin', { p_pin_type: pinType, p_target_id: targetId });
  clearNavPinsCache();
  if (error) throw error;
}

export async function clearNavPin(pinType) {
  const { error } = await supabase.rpc('clear_nav_pin', { p_pin_type: pinType });
  clearNavPinsCache();
  if (error) throw error;
}
