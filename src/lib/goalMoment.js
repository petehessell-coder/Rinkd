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
//   const goal = useGoalMoment(homeScore, awayScore, { myTeamSide });
//   <div className={goal ? 'rinkd-goal-glow' : undefined}>
//     {goal && <GoalSweep key={goal.key} side={goal.side} label={goal.label} muted={goal.muted} />}
//     …scores via <BounceNumber/>…
//   </div>
//
// S06 · Bundle L adds an optional us-vs-them hint (myTeamSide) that softens an
// opponent goal, a derived moment label ('TIED IT' / 'LEAD CHANGE' / 'GOAL!'),
// and a sibling usePeriodChange(period) pulse hook.

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
// The hook. Returns { key, side, label, muted } the instant a goal lands, then
// null again ~1.5s later (long enough for the sweep + bounce to play out).
//
//   · side   — 'home' | 'away', which team scored.
//   · label  — the derived moment: 'TIED IT' (the goal levels the score),
//              'LEAD CHANGE' (it flips who's ahead), else 'GOAL!'.
//   · muted  — true when an OPPONENT scored relative to `myTeamSide` (only ever
//              set when the caller passes a non-null myTeamSide). Callers dim the
//              sweep for it; the hook already softened the haptic + skipped the
//              horn. Neutral viewers (myTeamSide null) always get muted=false and
//              behavior identical to before.
//
// `myTeamSide` ('home'|'away'|null) is the OPTIONAL us-vs-them hint. When the
// team that scored is NOT the viewer's team, the celebration is softened: no
// horn, the lightest available haptic instead of the goal thump, and muted=true.
// -----------------------------------------------------------------------------
export function useGoalMoment(homeScore, awayScore, { enabled = true, ready = true, myTeamSide = null } = {}) {
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
    const ph = p.h, pa = p.a;             // score BEFORE this goal (for the label)
    prev.current = { h, a, init: true };
    if (!enabled) return;

    // A goal is +1 (or +2 when a debounced Realtime re-query batches two quick
    // ones). A larger jump is a hydration / resync artifact — update the
    // baseline silently. A decrease is a scorer correction — never celebrate it.
    const homeGoal = dh === 1 || dh === 2;
    const awayGoal = da === 1 || da === 2;
    if (!homeGoal && !awayGoal) return;

    const side = homeGoal && awayGoal ? (dh >= da ? 'home' : 'away') : homeGoal ? 'home' : 'away';

    // Derived moment label from the before → after score.
    //   · tie  : the score is now level.
    //   · flip : whoever was ahead before is now behind (a lead change). A goal
    //            that opens the scoring from 0–0 is NOT a flip (nobody led).
    const nowTied = h === a;
    const wasLeader = ph === pa ? null : (ph > pa ? 'home' : 'away');
    const nowLeader = h === a ? null : (h > a ? 'home' : 'away');
    const label = nowTied ? 'TIED IT'
      : (wasLeader && nowLeader && wasLeader !== nowLeader) ? 'LEAD CHANGE'
      : 'GOAL!';

    // us-vs-them: only when the caller supplied a side AND the opponent scored.
    const muted = !!myTeamSide && side !== myTeamSide;

    // Sensory feedback — each self-gates on its own user preference. For an
    // opponent goal we soften the haptic (lightest tick) and skip the horn.
    if (muted) {
      haptics.tick();
    } else {
      haptics.goal();
      playGoalHorn();
    }

    const key = ++seq.current;
    setGoal({ key, side, label, muted });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setGoal(null), 1500);
  }, [homeScore, awayScore, enabled, ready, myTeamSide]);

  return goal;
}

// -----------------------------------------------------------------------------
// usePeriodChange — a small pulse when the period really advances. Mirrors
// useGoalMoment's change-only discipline: it skips the first (hydration) read
// and only fires on a real INCREMENT (period going up — never a correction-down
// or a resync jump). Fires a light haptic and returns a boolean `pulse` that
// stays true for 900ms so the score box can flash a border. Under reduced motion
// the caller drops the visual; the haptic still fires (it's sensory feedback,
// governed by its own user setting — same rule as the goal thump).
// -----------------------------------------------------------------------------
export function usePeriodChange(period, { ready = true } = {}) {
  const prev = useRef({ p: period, init: false });
  const timer = useRef(null);
  const [pulse, setPulse] = useState(false);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    const n = Number(period) || 0;
    const p = prev.current;

    if (!ready) { prev.current = { p: n, init: false }; return; }
    if (!p.init) { prev.current = { p: n, init: true }; return; }

    const dp = n - p.p;
    prev.current = { p: n, init: true };

    // Only a real forward tick counts (1st→2nd, etc.). A single step is the
    // period changing; a bigger jump is a resync artifact — baseline silently.
    if (dp !== 1) return;

    haptics.tick();                       // light — self-gates on the haptics pref
    setPulse(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPulse(false), 900);
  }, [period, ready]);

  return pulse;
}

// -----------------------------------------------------------------------------
// <GoalSweep/> — the visual half. Drop inside a position:relative, overflow:
// hidden card. Renders the raking light bar + a GOAL! flare. No-op under reduced
// motion (returns the static container so layout never shifts). Pointer-through.
// -----------------------------------------------------------------------------
export function GoalSweep({ side = 'home', label = 'GOAL!', accent = colors.red, muted = false }) {
  ensureGoalKeyframes();
  const reduced = prefersReducedMotion();
  if (reduced) return null;
  // us-vs-them: an opponent goal is acknowledged, not celebrated — dim the whole
  // sweep to ~40% and drop the red flare to a neutral tone so it never reads as
  // "our" goal.
  const flareColor = muted ? 'rgba(244,247,250,0.85)' : accent;
  const flareShadow = muted ? '0 1px 2px rgba(0,0,0,0.5)' : '0 2px 10px rgba(215,38,56,0.7), 0 1px 2px rgba(0,0,0,0.5)';
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 4, opacity: muted ? 0.4 : 1 }}>
      {/* the light bar */}
      <div style={{
        position: 'absolute', top: 0, bottom: 0, left: 0, width: '42%',
        background: 'linear-gradient(100deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.16) 45%, rgba(255,255,255,0.42) 50%, rgba(255,255,255,0.16) 55%, rgba(255,255,255,0) 100%)',
        animation: 'rinkdGoalSweep 850ms cubic-bezier(0.22,0.61,0.36,1) forwards',
        mixBlendMode: 'screen',
      }} />
      {/* the moment flare — sits on the side that scored. label is the derived
          'GOAL!' / 'TIED IT' / 'LEAD CHANGE' from useGoalMoment. */}
      <div style={{
        position: 'absolute', top: 8,
        [side === 'home' ? 'left' : 'right']: 12,
        fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900,
        fontSize: 22, letterSpacing: '0.04em', color: flareColor,
        textShadow: flareShadow,
        animation: 'rinkdGoalFlare 1400ms cubic-bezier(0.34,1.56,0.64,1) forwards',
      }}>
        {label}
      </div>
    </div>
  );
}
