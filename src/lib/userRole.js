import { useEffect, useState } from 'react';
import { supabase } from './supabase';

/**
 * Derives the highest-privilege role the user holds, across all contexts.
 *   commissioner > manager > player
 *
 * Cheap two-query lookup, head:true so no row payload is sent.
 *   commissioner = commissioner_id of at least one league
 *   manager      = manager_id of at least one team
 *   player       = everyone else
 *
 * The role dropdown in the sidebar uses this to decide which menu items to show.
 */
export function useUserRole(userId) {
  // null = still resolving. Callers that gate an "access denied" screen on
  // role should render a neutral spinner while null, otherwise a real admin
  // sees the rejection screen flash during the async lookup.
  // `roleMenuSections(null)` falls through to the player-only menu, which is
  // the safe default for sidebar consumers that don't care about loading.
  const [role, setRole] = useState(null);

  useEffect(() => {
    if (!userId) { setRole('player'); return; }
    let cancelled = false;
    setRole(null);

    async function run() {
      const { count: leagueCount } = await supabase
        .from('leagues')
        .select('id', { count: 'exact', head: true })
        .eq('commissioner_id', userId);
      if (cancelled) return;
      if ((leagueCount || 0) > 0) { setRole('commissioner'); return; }

      const { count: teamCount } = await supabase
        .from('teams')
        .select('id', { count: 'exact', head: true })
        .eq('manager_id', userId);
      if (cancelled) return;
      if ((teamCount || 0) > 0) { setRole('manager'); return; }

      setRole('player');
    }

    run();
    return () => { cancelled = true; };
  }, [userId]);

  return role;
}

/**
 * Separate from useUserRole: Rinkd staff flag.
 *
 * Gates PLATFORM-LEVEL admin surfaces (analytics, feedback queue, content
 * moderation, Rinkside content publishing) — anything that crosses multiple
 * leagues or touches the operator's own data.
 *
 * Per-league commissioners do NOT get this. A user who runs their own beer
 * league as commissioner can manage THEIR league (via AdminPanel which
 * filters by commissioner_id internally), but they cannot see Rinkd's
 * analytics or other teams' moderation queues.
 *
 * Granted only via SQL (no UI surface):
 *   UPDATE profiles SET is_admin=true WHERE email='someone@rinkd.app';
 */
export function useIsRinkdAdmin(userId) {
  // null = still resolving. Callers that gate an "access denied" screen on
  // this should render a neutral spinner while null and only show rejection
  // once the value is definitively false.
  const [isAdmin, setIsAdmin] = useState(null);

  useEffect(() => {
    if (!userId) { setIsAdmin(false); return; }
    let cancelled = false;
    setIsAdmin(null);

    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', userId)
        .single();
      if (cancelled) return;
      setIsAdmin(data?.is_admin === true);
    })();

    return () => { cancelled = true; };
  }, [userId]);

  return isAdmin;
}

/**
 * Returns the role-specific dropdown items. Higher-privilege roles inherit
 * everything from lower roles, so a commissioner sees Player + Manager +
 * Commissioner sections.
 */
export function roleMenuSections(role) {
  const player = {
    label: 'Player',
    items: [
      { path: '/profile', icon: '📊', label: 'My Stats' },
      { path: '/teams',   icon: '👥', label: 'My Teams' },
    ],
  };
  const manager = {
    label: 'Manager',
    items: [
      { path: '/volunteer-coordinator', icon: '🙋', label: 'Volunteer Coordinator' },
      { path: '/dues-tracker',          icon: '💸', label: 'Dues Tracker' },
    ],
  };
  const commissioner = {
    label: 'Commissioner',
    items: [
      { path: '/admin', icon: '🛠️', label: 'Admin Panel' },
    ],
  };

  if (role === 'commissioner') return [commissioner, manager, player];
  if (role === 'manager')      return [manager, player];
  return [player];
}
