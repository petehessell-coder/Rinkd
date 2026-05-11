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
  const [role, setRole] = useState('player');

  useEffect(() => {
    if (!userId) { setRole('player'); return; }
    let cancelled = false;

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
