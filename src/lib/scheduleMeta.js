// Shared metadata for the unified team schedule (games + practices + events).
// One source of truth so TeamManage (builder) and Team (viewer) badge and color
// the three event types identically.
//
// Visual hierarchy (per DESIGN_MANIFESTO + the build spec):
//   game     = the headline. Brand red/primary, full-size row. Stands out.
//   practice = secondary. Calm steel-blue, condensed row. Clearly a quieter class.
//   event    = secondary. Its own subtle steel tone + badge. Same condensed weight.
// Practices/events are quieter but never tiny or skippable — legible type, real
// RSVP, ≥44px tap targets are enforced at the call sites.

import { C } from './tokens';

export const SCHEDULE_TYPES = ['game', 'practice', 'event'];

const META = {
  game: {
    type: 'game',
    label: 'Game',
    badge: 'GAME',
    icon: '🏒',
    accent: C.red,                 // headline / primary
    accentBg: 'rgba(215,38,56,0.16)',
    secondary: false,
  },
  practice: {
    type: 'practice',
    label: 'Practice',
    badge: 'PRACTICE',
    icon: '🧊',
    accent: C.blue,                // calm steel-blue secondary
    accentBg: 'rgba(46,91,140,0.20)',
    secondary: true,
  },
  event: {
    type: 'event',
    label: 'Event',
    badge: 'EVENT',
    icon: '📋',
    accent: '#7C8DB5',            // muted steel — distinct from practice, still calm
    accentBg: 'rgba(124,141,181,0.18)',
    secondary: true,
  },
};

/** Resolve event-type metadata. League/normalized rows have no event_type → game. */
export function eventMeta(type) {
  return META[type] || META.game;
}

/** Display title for any schedule row. Games → "vs/@ Opponent"; else the title. */
export function scheduleTitle(g) {
  const type = g.event_type || 'game';
  if (type === 'game') {
    return `${g.is_home ? 'vs.' : '@'} ${g.opponent || 'TBD'}`;
  }
  return g.title || eventMeta(type).label;
}
