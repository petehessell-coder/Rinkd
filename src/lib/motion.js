// =============================================================================
// Motion helper — the runtime half of the motion system.
//
// `tokens.js` holds the *vocabulary* (durations, easings). This holds the
// *behavior*: detecting `prefers-reduced-motion` and collapsing animation to a
// no-op when the user (or their OS) has asked for it. Manifesto rule, non-
// negotiable: "Disable all animation at prefers-reduced-motion."
//
//   import { prefersReducedMotion, motionSafe, transition, useReducedMotion } from '../lib/motion';
// =============================================================================
import { useState, useEffect } from 'react';
import { motion } from './tokens';

const QUERY = '(prefers-reduced-motion: reduce)';

// Synchronous read. Safe on the server / in tests (no `window`) — defaults to
// "motion is fine" so SSR markup matches a fresh client with motion enabled.
export function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

// Wrap any CSS `animation` / `transition` shorthand. Returns 'none' under
// reduced motion so the element simply renders in its final state.
//
//   style={{ animation: motionSafe(`rinkdIceRise ${motion.duration.reveal}ms ...`) }}
export function motionSafe(value) {
  return prefersReducedMotion() ? 'none' : value;
}

// Build a `transition` shorthand from motion tokens, reduced-motion aware.
//   transition('transform')                         -> 'transform 250ms cubic-bezier(...)'
//   transition(['opacity','transform'], 200, 'in')  -> 'opacity 200ms ..., transform 200ms ...'
// Under reduced motion it returns 'none'.
export function transition(props, durationMs = motion.duration.entrance, easing = 'out') {
  if (prefersReducedMotion()) return 'none';
  const ms = typeof durationMs === 'number' ? durationMs : motion.duration.entrance;
  const ease = motion.easing[easing] || easing || motion.easing.out;
  const list = Array.isArray(props) ? props : [props];
  return list.map((p) => `${p} ${ms}ms ${ease}`).join(', ');
}

// React hook — like `prefersReducedMotion()` but reactive: re-renders if the
// user flips the OS setting mid-session. Use in components; use the plain
// function for one-shot reads (e.g. inside an event handler).
export function useReducedMotion() {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia(QUERY);
    const onChange = () => setReduced(mq.matches);
    onChange();
    // addEventListener is the modern API; addListener is the Safari <14 fallback.
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, []);
  return reduced;
}
