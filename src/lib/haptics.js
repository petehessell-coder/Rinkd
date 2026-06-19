// SHARE-GOAL-1 — the haptics layer.
//
// A single, support-gated wrapper around the Vibration API. Every "thump" in the
// app routes through here so there's one place that:
//   · degrades SILENTLY where the API is missing (iOS Safari has no Vibration
//     API at all — these calls become harmless no-ops there, by design),
//   · honors a user opt-out (localStorage `rinkd_haptics`, default ON),
//   · never throws (a vibrate() can reject on some embedded webviews).
//
//   import { haptics } from '../lib/haptics';
//   haptics.like();   haptics.goal();   haptics.rip();
//
// Patterns are intentionally short and distinct so a goal FEELS different from a
// like. Haptics are sensory FEEDBACK, not animation — they are deliberately NOT
// gated on prefers-reduced-motion (a low-vision user may rely on the buzz). The
// visual + audio layers handle reduced-motion / mute on their own.

const KEY = 'rinkd_haptics';

function read() {
  try { return localStorage.getItem(KEY) !== '0'; } catch { return true; }
}

let enabled = read();

// Is the Vibration API even present? (false on iOS Safari, desktop Safari, and
// any browser without the API — callers don't need to check; fire() no-ops.)
export function supportsHaptics() {
  try { return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'; }
  catch { return false; }
}

export function hapticsEnabled() { return enabled; }

export function setHapticsEnabled(on) {
  enabled = !!on;
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* private mode — runtime flag still holds */ }
}

// The single choke-point. Returns true if a buzz was actually dispatched.
function fire(pattern) {
  if (!enabled || !supportsHaptics()) return false;
  try { return navigator.vibrate(pattern) === true; } catch { return false; }
}

// Named, tuned patterns. Durations in ms; arrays are [wait, buzz, wait, buzz…].
export const haptics = {
  // Light confirmations
  tick:    () => fire(7),               // a hair — peel "wrap" ticks, picker taps
  like:    () => fire(12),              // ❤️ a single soft tap
  press:   () => fire(9),

  // Events worth feeling
  goal:    () => fire([0, 55, 38, 120]),// the goal THUMP — two hits, the second heavier
  rip:     () => fire([0, 28, 18, 42]), // peel "rrrip" (matches the original GamePuck buzz)
  refresh: () => fire([0, 13, 9, 22]),  // pull-to-refresh release — a clean double-pop
  success: () => fire([0, 22, 40, 22]),

  // Escape hatch for one-off patterns.
  custom:  (pattern) => fire(pattern),
  stop:    () => { try { navigator.vibrate && navigator.vibrate(0); } catch { /* no-op */ } },
};

export default haptics;
