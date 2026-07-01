import React, { useCallback, useEffect, useRef, useState } from 'react';
import PuckMark from './PuckMark';
import { haptics } from '../lib/haptics';
import { prefersReducedMotion } from '../lib/motion';
import { C } from '../lib/tokens';

// SHARE-GOAL-1 — branded pull-to-refresh.
//
// The manifesto's "period intermission" loading rule applied to the home pull:
// drag the top of the feed and a puck spins up over "Getting the ice ready."
// Releasing past the threshold fires a haptic and refreshes. Touch-only — desktop
// passes through untouched (PTR is a phone gesture). While mounted on a touch
// device it sets overscroll-behavior to `contain` so the browser's own
// grey-spinner pull doesn't double up with ours.
//
//   <PullToRefresh onRefresh={load}>{feed}</PullToRefresh>
//
// Implementation notes:
//   · Listens on window (the feed scrolls the document). Only engages when the
//     page is already at the very top AND the finger is travelling DOWN, so it
//     never hijacks a normal scroll.
//   · Uses a top SPACER whose height tracks the pull — no transforms, so it can't
//     turn the feed into a containing block for the app's position:fixed nav
//     (see lib/motion's route-transition note).
//   · Live pull state lives in refs so the window listeners bind ONCE, not on
//     every touch frame (which would thrash and could drop a touchend).

const THRESHOLD = 64;   // px of resolved pull needed to arm a refresh
const MAX_PULL = 96;    // hard cap so a long drag can't push the feed off-screen
const RESISTANCE = 0.5; // finger travel → indicator travel (rubber-band feel)
const MIN_SPIN_MS = 550;// keep the puck up at least this long so it never flashes

function isTouch() {
  try { return (navigator.maxTouchPoints || 0) > 0 || (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches); }
  catch { return false; }
}

export default function PullToRefresh({ onRefresh, children, topOffset = 0 }) {
  const [enabled] = useState(isTouch);
  const [pull, setPull] = useState(0);       // resolved indicator height, 0..MAX_PULL
  const [refreshing, setRefreshing] = useState(false);
  const [dragging, setDragging] = useState(false);

  const startY = useRef(0);
  const tracking = useRef(false);
  const armed = useRef(false);
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);
  const reduced = prefersReducedMotion();

  const setPullBoth = useCallback((v) => { pullRef.current = v; setPull(v); }, []);

  const run = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    haptics.refresh();
    const started = Date.now();
    try { await onRefresh?.(); } catch { /* the caller surfaces its own errors */ }
    const wait = Math.max(0, MIN_SPIN_MS - (Date.now() - started));
    setTimeout(() => {
      refreshingRef.current = false;
      setRefreshing(false);
      setPullBoth(0);
    }, wait);
  }, [onRefresh, setPullBoth]);

  useEffect(() => {
    if (!enabled || !onRefresh) return undefined;

    // Suppress the native pull-to-refresh while this is mounted; restore on leave.
    const html = document.documentElement;
    const prevOB = html.style.overscrollBehaviorY;
    html.style.overscrollBehaviorY = 'contain';

    const atTop = () => (window.scrollY || window.pageYOffset || 0) <= 0;

    const onStart = (e) => {
      if (refreshingRef.current || e.touches.length !== 1 || !atTop()) { tracking.current = false; return; }
      tracking.current = true;
      armed.current = false;
      startY.current = e.touches[0].clientY;
    };
    const onMove = (e) => {
      if (!tracking.current || refreshingRef.current) return;
      const dy = e.touches[0].clientY - startY.current;
      // Finger moving up, or the page scrolled off the top → it's a scroll, not a
      // pull. Bail and hand the gesture back to the browser.
      if (dy <= 0 || !atTop()) {
        if (armed.current) { armed.current = false; setDragging(false); setPullBoth(0); }
        tracking.current = false;
        return;
      }
      if (!armed.current) { armed.current = true; setDragging(true); }
      e.preventDefault(); // we own this gesture now
      setPullBoth(Math.min(MAX_PULL, dy * RESISTANCE));
    };
    const onEnd = () => {
      if (!tracking.current) return;
      tracking.current = false;
      setDragging(false);
      if (armed.current && pullRef.current >= THRESHOLD) run();
      else setPullBoth(0);
      armed.current = false;
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      html.style.overscrollBehaviorY = prevOB;
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [enabled, onRefresh, run, setPullBoth]);

  if (!enabled || !onRefresh) return <>{children}</>;

  const h = refreshing ? 56 : pull;
  const progress = Math.min(1, pull / THRESHOLD);
  const ready = pull >= THRESHOLD;
  const label = refreshing ? 'Getting the ice ready.' : ready ? 'Release to refresh' : 'Pull to refresh';
  // Puck rotates with the pull, then spins continuously while refreshing.
  const rotate = reduced ? 0 : refreshing ? null : progress * 320;

  return (
    <div style={{ position: 'relative' }}>
      <div aria-hidden style={{
        height: h, marginTop: topOffset, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 6,
        transition: dragging ? 'none' : 'height 0.28s cubic-bezier(0.22,0.61,0.36,1)',
        opacity: h <= 1 ? 0 : 1,
      }}>
        <div className={refreshing && !reduced ? 'rinkd-ptr-spin' : undefined}
          style={{ transform: rotate == null ? undefined : `rotate(${rotate}deg)`, transition: dragging ? 'none' : 'transform 0.2s', lineHeight: 0 }}>
          <PuckMark size={24} />
        </div>
        <span style={{
          fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 700,
          fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase',
          color: ready || refreshing ? C.red : C.steel, transition: 'color 0.15s',
        }}>{label}</span>
      </div>
      {children}
    </div>
  );
}

// Continuous spin keyframe for the refreshing state (reduced-motion safe).
if (typeof document !== 'undefined' && !document.getElementById('rinkd-ptr-anim')) {
  const el = document.createElement('style');
  el.id = 'rinkd-ptr-anim';
  el.textContent =
    '@keyframes rinkdPtrSpin{from{transform:rotate(0)}to{transform:rotate(360deg)}}' +
    '.rinkd-ptr-spin{animation:rinkdPtrSpin 0.9s linear infinite}' +
    '@media (prefers-reduced-motion: reduce){.rinkd-ptr-spin{animation:none}}';
  document.head.appendChild(el);
}
