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
import { useState, useEffect, useRef, useCallback } from 'react';
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

// -----------------------------------------------------------------------------
// Shared keyframes — injected once, globally. Each is paired with a
// prefers-reduced-motion override that flattens it to a no-op, so even a stray
// class application can't animate against the user's wishes.
// -----------------------------------------------------------------------------
let injected = false;
export function ensureMotionKeyframes() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const el = document.createElement('style');
  el.textContent =
    // Route entrance — OPACITY ONLY (no transform). Critical: this class wraps
    // <Routes>, which contains the app's position:fixed nav (sidebar + mobile
    // bars). Any non-none transform here — including the identity matrix that
    // `animation-fill-mode:both` holds from a `transform:none` keyframe — makes
    // this element a containing block for fixed descendants, which pins the
    // bottom nav to the bottom of the scrolled content (off-screen) and breaks
    // the sidebar. A fade can't create a containing block, so the nav is safe.
    `@keyframes rinkdRouteIn{from{opacity:0}to{opacity:1}}` +
    `.rinkd-route-in{animation:rinkdRouteIn ${motion.duration.entrance}ms ${motion.easing.out} both}` +
    // Staggered list entrance — fade + small rise (per-item delay set inline).
    `@keyframes rinkdStaggerIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}` +
    // Goal bounce — scale(1.2)->1.0 with overshoot easing → a single hard bounce.
    `@keyframes rinkdGoalBounce{from{transform:scale(1.2)}to{transform:scale(1)}}` +
    `.rinkd-goal-bounce{display:inline-block;animation:rinkdGoalBounce ${motion.duration.score}ms ${motion.easing.puck} both;transform-origin:center}` +
    `@media (prefers-reduced-motion: reduce){` +
      `.rinkd-route-in,.rinkd-goal-bounce,[data-stagger]{animation:none!important}` +
    `}`;
  document.head.appendChild(el);
}

// Inline style for a staggered list-item entrance. Apply to each item with its
// index; later items wait a touch longer (capped so a long list doesn't lag).
// No-op under reduced motion. Works on table rows too (opacity survives even
// where transform on <tr> doesn't).
export function staggerStyle(index, reduce) {
  if (reduce || prefersReducedMotion()) return undefined;
  ensureMotionKeyframes();
  const delay = Math.min(index, 14) * 35;
  return {
    animation: `rinkdStaggerIn ${motion.duration.entrance}ms ${motion.easing.out} ${delay}ms both`,
  };
}

// Returns a counter that increments ONLY when `value` actually changes (and not
// on the initial mount, and not under reduced motion). Re-render churn from
// Realtime that doesn't change the value leaves it untouched — so a goal bounce
// fires on a real score change, never on every socket message. Use the returned
// number as a React `key` to restart the bounce animation each change.
export function useValueBounce(value) {
  const prev = useRef(value);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    if (prev.current !== value) {
      if (prev.current !== undefined && prev.current !== null && !prefersReducedMotion()) {
        setBump((b) => b + 1);
      }
      prev.current = value;
    }
  }, [value]);
  return bump;
}

// True only after `active` has stayed true for `delayMs`. Lets a skeleton wait
// out a sub-1s load (manifesto: under 300ms show nothing; over 1s show the
// skeleton) so fast responses never flash a placeholder.
export function useDelayedFlag(active, delayMs = 1000) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!active) { setShow(false); return undefined; }
    const t = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(t);
  }, [active, delayMs]);
  return show;
}

// Press-state hook — the scale(0.97) "puck into tape" feel. Returns the pressed
// flag + the pointer handlers to spread onto an element. Caller applies the
// transform (so it can compose with its own). No-op visuals under reduced
// motion are the caller's responsibility via the returned flag.
export function usePress() {
  const [pressed, setPressed] = useState(false);
  const down = useCallback(() => setPressed(true), []);
  const up = useCallback(() => setPressed(false), []);
  return {
    pressed,
    pressHandlers: { onPointerDown: down, onPointerUp: up, onPointerLeave: up, onPointerCancel: up },
  };
}
