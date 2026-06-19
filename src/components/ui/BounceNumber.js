import React from 'react';
import { useValueBounce, ensureMotionKeyframes } from '../../lib/motion';

// =============================================================================
// BounceNumber — a score/number that does a single hard "goal bounce"
// (scale(1.2)->1.0, manifesto "Goal scored") the moment its value actually
// changes. Drop it in anywhere a live score renders:
//
//   <BounceNumber value={game.home_score ?? 0} style={scoreStyle} />
//
// It fires ONLY on a real value change — not on every re-render or Realtime
// tick (the value is compared, see useValueBounce), and never on first mount.
// No-op under prefers-reduced-motion. It does NOT read or touch any Realtime /
// scoring logic — it only observes the value handed to it.
// =============================================================================
export default function BounceNumber({ value, as: Tag = 'span', style, ...rest }) {
  ensureMotionKeyframes();
  const bump = useValueBounce(value);
  return (
    // key={bump} restarts the animation on each change; bump===0 (mount / no
    // change yet) means no class, so nothing animates on load.
    <Tag key={bump} className={bump ? 'rinkd-goal-bounce' : undefined} style={style} {...rest}>
      {value}
    </Tag>
  );
}
