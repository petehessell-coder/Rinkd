import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useReducedMotion, ensureMotionKeyframes } from '../../lib/motion';
import { colors, motion } from '../../lib/tokens';

// =============================================================================
// MotionProvider + useExpand — a shared-element-style "card opens into the
// page" transition. Tapping a feed/game card grows a panel from the card's
// rect to fill the screen and dissolves, instead of a hard route cut.
//
//   const expand = useExpand();
//   onClick={(e) => expand(e, () => navigate(`/game/${id}`))}
//
// The overlay is purely cosmetic and time-boxed: navigation fires immediately,
// the new page mounts underneath, and the panel auto-clears (~380ms) even if a
// transitionend never arrives. So it can never trap the user or block routing.
// No-op under prefers-reduced-motion (just navigates).
// =============================================================================
const ExpandContext = createContext(null);

export function MotionProvider({ children }) {
  const [layer, setLayer] = useState(null);
  const reduce = useReducedMotion();

  useEffect(() => { ensureMotionKeyframes(); }, []);

  const expandFrom = useCallback((rect, bg, radius) => {
    setLayer({ rect, bg: bg || colors.surfaceElevated, radius: radius == null ? 12 : radius });
  }, []);

  return (
    <ExpandContext.Provider value={{ expandFrom, reduce }}>
      {children}
      {layer && <ExpandOverlay layer={layer} onDone={() => setLayer(null)} />}
    </ExpandContext.Provider>
  );
}

function ExpandOverlay({ layer, onDone }) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setExpanded(true));
    // Safety net: always tear down even if transitionend is missed.
    const t = setTimeout(onDone, motion.duration.score + 80);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [onDone]);

  const ease = motion.easing.out;
  const w = typeof window !== 'undefined' ? window.innerWidth : 0;
  const h = typeof window !== 'undefined' ? window.innerHeight : 0;
  const base = {
    position: 'fixed', zIndex: 9500, background: layer.bg,
    pointerEvents: 'none', willChange: 'top,left,width,height,opacity',
  };
  const style = expanded
    ? {
        ...base, top: 0, left: 0, width: w, height: h, borderRadius: 0, opacity: 0,
        transition: `top ${motion.duration.score}ms ${ease}, left ${motion.duration.score}ms ${ease}, width ${motion.duration.score}ms ${ease}, height ${motion.duration.score}ms ${ease}, border-radius ${motion.duration.score}ms ${ease}, opacity ${motion.duration.score}ms ease-in`,
      }
    : {
        ...base, top: layer.rect.top, left: layer.rect.left,
        width: layer.rect.width, height: layer.rect.height,
        borderRadius: layer.radius, opacity: 1,
      };
  return <div aria-hidden="true" style={style} onTransitionEnd={onDone} />;
}

// Returns expand(event, navigateFn, opts?). Captures the tapped element's rect,
// kicks off the overlay, then runs navigateFn immediately. Falls back to a
// plain navigateFn() under reduced motion or if no provider is mounted.
export function useExpand() {
  const ctx = useContext(ExpandContext);
  return useCallback((event, navigateFn, opts = {}) => {
    const el = event && event.currentTarget;
    if (!ctx || ctx.reduce || !el || typeof el.getBoundingClientRect !== 'function') {
      navigateFn();
      return;
    }
    const r = el.getBoundingClientRect();
    ctx.expandFrom({ top: r.top, left: r.left, width: r.width, height: r.height }, opts.bg, opts.radius);
    navigateFn();
  }, [ctx]);
}
