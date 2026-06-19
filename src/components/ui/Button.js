import React, { useState } from 'react';
import { C, radii, shadows, motion, font } from '../../lib/tokens';
import { prefersReducedMotion } from '../../lib/motion';

// =============================================================================
// Button — the pill. Manifesto "Interaction Principles › Primary/Secondary".
//
// Every interactive element needs FOUR explicit states (enterprise standard):
//   1. resting   2. hover / press   3. loading   4. disabled
//
// Variants:
//   primary   — red fill, red glow shadow, collapses on press. The one CTA.
//   secondary — transparent, bordered; fills to blue-wash on press.
//   ghost     — text-only, for low-emphasis inline actions.
//
// Accessibility: min 44×44 tap target, aria-busy while loading, and a disabled
// button never sits dark without a reason — pass `disabledReason` and it
// surfaces as a native tooltip (manifesto: never disable without telling why).
// =============================================================================
const VARIANTS = {
  primary: {
    rest:  { background: C.red, color: '#fff', border: '1px solid transparent', boxShadow: shadows.heroRed },
    press: { background: C.red, color: '#fff', border: '1px solid transparent', boxShadow: '0 2px 8px rgba(215,38,56,0.4)' },
  },
  secondary: {
    rest:  { background: 'transparent', color: C.ice, border: `1px solid ${C.border}`, boxShadow: 'none' },
    press: { background: 'rgba(46,91,140,0.2)', color: C.ice, border: `1px solid ${C.border}`, boxShadow: 'none' },
  },
  ghost: {
    rest:  { background: 'transparent', color: C.steel, border: '1px solid transparent', boxShadow: 'none' },
    press: { background: 'rgba(46,91,140,0.15)', color: C.ice, border: '1px solid transparent', boxShadow: 'none' },
  },
};

const SIZES = {
  sm: { padding: '8px 16px',  fontSize: 13, minHeight: 44 }, // tap target floor holds even on sm
  md: { padding: '11px 22px', fontSize: 14, minHeight: 46 },
  lg: { padding: '14px 28px', fontSize: 16, minHeight: 52 },
};

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  disabledReason,
  fullWidth = false,
  onClick,
  type = 'button',
  style,
  ...rest
}) {
  const [pressed, setPressed] = useState(false);
  const v = VARIANTS[variant] || VARIANTS.primary;
  const sz = SIZES[size] || SIZES.md;
  const isDead = disabled || loading;
  const reduce = prefersReducedMotion();

  // Press visuals only apply when the button is live and the user isn't asking
  // for reduced motion (the scale dip is motion).
  const showPress = pressed && !isDead && !reduce;
  const state = showPress ? v.press : v.rest;

  return (
    <button
      type={type}
      disabled={isDead}
      aria-busy={loading || undefined}
      title={disabled && disabledReason ? disabledReason : undefined}
      onClick={isDead ? undefined : onClick}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        width: fullWidth ? '100%' : undefined,
        maxWidth: '100%', minWidth: 0,
        padding: sz.padding, minHeight: sz.minHeight, fontSize: sz.fontSize,
        fontFamily: font.display, fontWeight: 900, fontStyle: 'italic',
        letterSpacing: '0.04em', textTransform: 'uppercase',
        borderRadius: radii.button, cursor: isDead ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        transform: showPress ? 'scale(0.97)' : 'scale(1)',
        transition: reduce ? 'none' : `transform ${motion.duration.press}ms ${motion.easing.inOut}, box-shadow ${motion.duration.press}ms ${motion.easing.inOut}, background ${motion.duration.press}ms ${motion.easing.inOut}`,
        // Long labels truncate rather than blow out the pill.
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        WebkitTapHighlightColor: 'transparent',
        ...state,
        ...style,
      }}
      {...rest}
    >
      {loading ? <LoadingDots /> : children}
    </button>
  );
}

// Three pulsing dots — a puck-tap rhythm, not a generic spinner (manifesto bans
// spinners). Under reduced motion they hold steady so the button still reads as
// busy via aria-busy + the dimmed state.
function LoadingDots() {
  const reduce = prefersReducedMotion();
  ensureDotsKeyframes();
  const dot = (i) => ({
    width: 6, height: 6, borderRadius: 999, background: 'currentColor',
    opacity: reduce ? 0.6 : undefined,
    animation: reduce ? 'none' : `rinkdBtnDot 900ms ${motion.easing.inOut} ${i * 150}ms infinite`,
  });
  return (
    <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={dot(0)} /><span style={dot(1)} /><span style={dot(2)} />
    </span>
  );
}

let dotsInjected = false;
function ensureDotsKeyframes() {
  if (dotsInjected || typeof document === 'undefined') return;
  dotsInjected = true;
  const el = document.createElement('style');
  el.textContent = '@keyframes rinkdBtnDot{0%,100%{opacity:0.35;transform:translateY(0)}50%{opacity:1;transform:translateY(-2px)}}';
  document.head.appendChild(el);
}
