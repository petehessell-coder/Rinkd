// SHARE-GOAL-1 — the synchronized live-goal moment.
//
// One hook detects a *real* goal (a score that ticks UP by 1 or 2 — never a
// correction-down, never the first hydration read, never socket churn that
// doesn't move the number) and fires the synchronized celebration:
//   · the score number bounces           (already handled by <BounceNumber/>)
//   · the card lights up                 (<GoalSweep/> + the glow class)
//   · a haptic THUMP                     (haptics.goal — sensory, user-toggleable)
//   · the opt-in goal horn               (sound.playGoalHorn — muted by default)
//
// The feedback (haptic + horn) is sensory and fires regardless of
// prefers-reduced-motion (each is governed by its OWN user setting); the VISUAL
// sweep/flare is suppressed under reduced motion. Mirrors useValueBounce's
// change-only discipline so a Realtime tick that doesn't change the score is
// silent.
//
//   const goal = useGoalMoment(homeScore, awayScore);
//   <div className={goal ? 'rinkd-goal-glow' : undefined}>
//     {goal && <GoalSweep key={goal.key} side={goal.side} />}
//     …scores via <BounceNumber/>…
//   </div>

import React, { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from './motion';
import { haptics } from './haptics';
import { playGoalHorn } from './sound';
import { colors } from './tokens';

// -----------------------------------------------------------------------------
// Keyframes — injected once. Each has a reduced-motion no-op override.
// -----------------------------------------------------------------------------
let injected = false;
export function ensureGoalKeyframes() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const el = document.createElement('style');
  el.id = 'rinkd-goal-moment';
  el.textContent =
    // A light bar rakes across the card, left→right — a rink light turning on.
    '@keyframes rinkdGoalSweep{0%{transform:translateX(-140%) skewX(-14deg);opacity:0}' +
      '15%{opacity:0.85}100%{transform:translateX(240%) skewX(-14deg);opacity:0}}' +
    // The card itself flares — red ring tightens + glow swells, single beat.
    '@keyframes rinkdGoalGlow{0%{box-shadow:0 0 0 1px rgba(215,38,56,0.6),0 8px 32px rgba(215,38,56,0.2)}' +
      '28%{box-shadow:0 0 0 2px rgba(215,38,56,1),0 16px 50px rgba(215,38,56,0.55)}' +
      '100%{box-shadow:0 0 0 1px rgba(215,38,56,0.6),0 8px 32px rgba(215,38,56,0.2)}}' +
    // The GOAL! flare punches in, holds, fades.
    '@keyframes rinkdGoalFlare{0%{transform:scale(0.7);opacity:0}18%{transform:scale(1.06);opacity:1}' +
      '70%{transform:scale(1);opacity:1}100%{transform:scale(1.02);opacity:0}}' +
    '.rinkd-goal-glow{animation:rinkdGoalGlow 900ms ease-out}' +
    '@media (prefers-reduced-motion: reduce){.rinkd-goal-glow{animation:none}}';
  document.head.appendChild(el);
}

// -----------------------------------------------------------------------------
// The hook. Returns { key, side } the instant a goal lands, then null again
// ~1.5s later (long enough for the sweep + bounce to play out).
// -----------------------------------------------------------------------------
export function useGoalMoment(homeScore, awayScore, { enabled = true, ready = true } = {}) {
  const prev = useRef({ h: homeScore, a: awayScore, init: false });
  const seq = useRef(0);
  const timer = useRef(null);
  const [goal, setGoal] = useState(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    const h = Number(homeScore) || 0;
    const a = Number(awayScore) || 0;
    const p = prev.current;

    // Not ready yet (data still loading) — keep re-baselining to the latest read
    // so the loading 0–0 → hydrated 3–2 jump never counts as live goals.
    if (!ready) { prev.current = { h, a, init: false }; return; }

    // First ready read is the baseline — opening an in-progress game must NOT
    // blast the horn for goals that happened before you got there.
    if (!p.init) { prev.current = { h, a, init: true }; return; }

    const dh = h - p.h, da = a - p.a;
    prev.current = { h, a, init: true };
    if (!enabled) return;

    // A goal is +1 (or +2 when a debounced Realtime re-query batches two quick
    // ones). A larger jump is a hydration / resync artifact — update the
    // baseline silently. A decrease is a scorer correction — never celebrate it.
    const homeGoal = dh === 1 || dh === 2;
    const awayGoal = da === 1 || da === 2;
    if (!homeGoal && !awayGoal) return;

    const side = homeGoal && awayGoal ? (dh >= da ? 'home' : 'away') : homeGoal ? 'home' : 'away';

    // Sensory feedback — each self-gates on its own user preference.
    haptics.goal();
    playGoalHorn();

    const key = ++seq.current;
    setGoal({ key, side });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setGoal(null), 1500);
  }, [homeScore, awayScore, enabled, ready]);

  return goal;
}

// -----------------------------------------------------------------------------
// <GoalSweep/> — the visual half. Drop inside a position:relative, overflow:
// hidden card. Renders the raking light bar + a GOAL! flare. No-op under reduced
// motion (returns the static container so layout never shifts). Pointer-through.
// -----------------------------------------------------------------------------
export function GoalSweep({ side = 'home', label = 'GOAL!', accent = colors.red }) {
  ensureGoalKeyframes();
  const reduced = prefersReducedMotion();
  if (reduced) return null;
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 4 }}>
      {/* the light bar */}
      <div style={{
        position: 'absolute', top: 0, bottom: 0, left: 0, width: '42%',
        background: 'linear-gradient(100deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.16) 45%, rgba(255,255,255,0.42) 50%, rgba(255,255,255,0.16) 55%, rgba(255,255,255,0) 100%)',
        animation: 'rinkdGoalSweep 850ms cubic-bezier(0.22,0.61,0.36,1) forwards',
        mixBlendMode: 'screen',
      }} />
      {/* the GOAL! flare — sits on the side that scored */}
      <div style={{
        position: 'absolute', top: 8,
        [side === 'home' ? 'left' : 'right']: 12,
        fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900,
        fontSize: 22, letterSpacing: '0.04em', color: accent,
        textShadow: '0 2px 10px rgba(215,38,56,0.7), 0 1px 2px rgba(0,0,0,0.5)',
        animation: 'rinkdGoalFlare 1400ms cubic-bezier(0.34,1.56,0.64,1) forwards',
      }}>
        {label}
      </div>
    </div>
  );
}
