import React, { useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useReducedMotion, ensureMotionKeyframes } from '../../lib/motion';

// =============================================================================
// RouteTransition — gives every page a directional fade-up entrance on
// navigation (manifesto: "No bounce on nav transitions — directional only").
//
// It replays the entrance by toggling a class on pathname change WITHOUT
// remounting children, so pages keep their own mount/fetch behavior — no
// double-loads. No-op under reduced motion.
// =============================================================================
export default function RouteTransition({ children }) {
  const { pathname } = useLocation();
  const ref = useRef(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    ensureMotionKeyframes();
    if (reduce || !ref.current) return;
    const el = ref.current;
    // Remove → force reflow → re-add so the CSS animation restarts each route.
    el.classList.remove('rinkd-route-in');
    void el.offsetWidth;
    el.classList.add('rinkd-route-in');
  }, [pathname, reduce]);

  return <div ref={ref} className={reduce ? undefined : 'rinkd-route-in'}>{children}</div>;
}
