// =============================================================================
// Rinkd Design Tokens — the single source of truth for the visual system.
//
// Every value here is pulled directly from DESIGN_MANIFESTO.md ("Design Tokens"
// + "Motion Language"). If the manifesto changes, this file changes — and the
// whole app moves with it. Do NOT redeclare a `const C = {...}` palette in a
// component again; import from here.
//
//   import { C, colors, type, space, radii, shadows, motion } from '../lib/tokens';
//
// `colors` carries the manifesto's *semantic* roles (prefer these in new code).
// `C` is the backward-compatible brand shorthand (navy/blue/red/ice/steel/...)
// the existing pages already speak — same keys, manifesto-aligned values.
// =============================================================================

// -----------------------------------------------------------------------------
// COLORS — manifesto "Design Tokens › Colors" + "Color Intent"
// -----------------------------------------------------------------------------
//
// Note on the base navy: the manifesto lists the deep-rink background as
// #0A1E38, but production has shipped #0B1F3A in every surface since launch.
// The two differ by ≤2 per channel — visually indistinguishable. We standardize
// the token on the deployed value (#0B1F3A) so the palette is internally
// consistent rather than splitting hairs no eye can see.
export const colors = {
  // Backgrounds & surfaces
  bg:              '#0B1F3A', // deep rink — app background (manifesto: ~#0A1E38)
  surface:         '#0f2847', // boards — the standard card surface
  surfaceElevated: '#162f55', // cards that matter — live games, hero, featured
  surfaceDeep:     '#07111F', // deepest inset / overlay shade (below the boards)

  // Borders
  border:          'rgba(46,91,140,0.4)', // default
  borderAccent:    'rgba(46,91,140,0.8)', // accent / hover / hero surfaces

  // Brand — used with intent (see manifesto "Color Intent")
  red:             '#D72638',              // action + urgency ONLY (CTA, live, errors)
  redGlow:         'rgba(215,38,56,0.35)', // primary CTA / live shadow glow
  blue:            '#2E5B8C',              // the rink light — live cards, elevated accents
  blueGlow:        'rgba(46,91,140,0.4)',  // game-card shadow glow
  gold:            '#C9A84C',              // milestones / awards ONLY — scarce by design

  // Text
  ice:             '#F4F7FA', // primary text — never a background
  muted:           '#8BA3BE', // secondary text — allowed to stay quiet

  // C01 semantic + accent additions (Pete sign-off 2026-07-01, D1–D4)
  success:  '#22C55E',   // success / complete / paid
  warning:  '#F59E0B',   // warning / pending / needs attention
  onAccent: '#FFFFFF',   // text/icons ON a saturated surface (red/blue/colored)
  redSoft:  '#E26B6B',   // error text on dark
  redDeep:  '#B51E2E',   // pressed / hover red
  premium:  '#8B5CF6',   // Crease / paid-video tier accent
};

// Backward-compatible brand shorthand. These are the keys the pages already use
// (`C.navy`, `C.card`, `C.steel`, …). Values are sourced from `colors` above so
// there is exactly one place a hex lives. Adding `gold` here is additive — no
// page referenced it before, so nothing changes for existing call sites.
export const C = {
  navy:   colors.bg,            // '#0B1F3A'
  blue:   colors.blue,          // '#2E5B8C'
  red:    colors.red,           // '#D72638'
  ice:    colors.ice,           // '#F4F7FA'
  steel:  colors.muted,         // '#8BA3BE'
  dark:   colors.surfaceDeep,   // '#07111F'
  card:   colors.surface,       // '#0f2847'
  border: colors.border,        // 'rgba(46,91,140,0.4)'
  gold:   colors.gold,          // '#C9A84C'
};

// -----------------------------------------------------------------------------
// TYPOGRAPHY — manifesto "Design Tokens › Typography"
// -----------------------------------------------------------------------------
//
// Two families: condensed for anything that should feel like a jersey/broadcast
// (heroes, section heads, numbers), and Barlow for body/labels/metadata.
export const font = {
  display: "'Barlow Condensed', sans-serif", // heroes, section heads, stats
  body:    "'Barlow', sans-serif",           // body copy, labels, metadata
};

// Named text styles — spread directly into an inline `style`:
//   <div style={{ ...type.sectionHead, color: C.ice }}>PERIOD 2 · LIVE</div>
// fontSize values sit in the middle of the manifesto's stated ranges; bump per
// surface where a hero needs to be bigger.
export const type = {
  // Hero moments — 48–72px, Barlow Condensed 900 italic
  hero:        { fontFamily: font.display, fontWeight: 900, fontStyle: 'italic', fontSize: 56, lineHeight: 1.0,  letterSpacing: '0.01em' },
  // Page titles — 28–36px
  pageTitle:   { fontFamily: font.display, fontWeight: 900, fontStyle: 'italic', fontSize: 30, lineHeight: 1.05, letterSpacing: '0.01em' },
  // Section heads — 18–22px, 700 italic, used in the broadcast lower-third
  sectionHead: { fontFamily: font.display, fontWeight: 700, fontStyle: 'italic', fontSize: 20, lineHeight: 1.1,  letterSpacing: '0.05em', textTransform: 'uppercase' },
  // Body / labels — 13–15px, Barlow 500
  body:        { fontFamily: font.body,    fontWeight: 500, fontStyle: 'normal', fontSize: 14, lineHeight: 1.5 },
  // Numbers / stats — ALWAYS Barlow Condensed 900 italic, tabular figures so
  // columns of numbers don't jitter as values change.
  stat:        { fontFamily: font.display, fontWeight: 900, fontStyle: 'italic', fontVariantNumeric: 'tabular-nums', letterSpacing: '0.01em' },
  // Metadata — 11–12px, Barlow 400, muted
  meta:        { fontFamily: font.body,    fontWeight: 400, fontStyle: 'normal', fontSize: 12, lineHeight: 1.4 },
};

// -----------------------------------------------------------------------------
// SPACING — manifesto "Design Tokens › Spacing Rhythm" (4px grid)
// -----------------------------------------------------------------------------
// `xxl` is the manifesto's "2xl" (a numeric key can't be dot-accessed in JS).
export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 };

// -----------------------------------------------------------------------------
// RADII — manifesto "Design Tokens › Corner Philosophy"
// -----------------------------------------------------------------------------
export const radii = {
  card:   12,  // standard cards
  button: 999, // pill — decisive, not bubbly
  chip:   6,   // badges / chips / tags
  hero:   4,   // hero surfaces — sharp = hard = hockey (0 or 4)
  sheet:  16,  // modal sheets — top corners only
};

// -----------------------------------------------------------------------------
// SHADOWS — manifesto "Design Tokens › Shadow / Depth System"
// -----------------------------------------------------------------------------
export const shadows = {
  resting:  'none',                                                       // flat on the surface
  hover:    '0 4px 16px rgba(0,0,0,0.4)',                                 // active / hover lift
  heroRed:  '0 8px 24px rgba(215,38,56,0.35)',                            // primary CTA glow
  heroBlue: '0 8px 24px rgba(46,91,140,0.4)',                             // game-card glow
  live:     '0 0 0 1px rgba(215,38,56,0.6), 0 8px 32px rgba(215,38,56,0.2)', // live game card
};

// -----------------------------------------------------------------------------
// MOTION — manifesto "Motion Language" (puck physics: quick in, smooth stop)
// -----------------------------------------------------------------------------
// Durations in ms. Easings as CSS cubic-beziers. The runtime reduced-motion
// helpers live in ./motion (they need `window`); this is just the vocabulary.
export const motion = {
  duration: {
    press:        100,  // tap — scale(0.97)
    exit:         200,  // fade-out + translateY(8px)
    tab:          200,  // tab indicator slide
    score:        200,  // goal bounce
    entrance:     250,  // fade-in + translateY(-8px)
    pulseStep:    300,  // milestone / press-release
    sheet:        350,  // sheet slide up
    numberChange: 400,  // count-up
    reveal:       560,  // onboarding ice-rise (a one-time reveal, allowed >400ms)
    pulse:       1500,  // live-indicator ring expand, infinite
  },
  easing: {
    out:   'cubic-bezier(0.22, 0.61, 0.36, 1)', // ease-out — entrances, the ice rise
    in:    'cubic-bezier(0.4, 0, 1, 1)',         // ease-in — exits
    inOut: 'cubic-bezier(0.4, 0, 0.2, 1)',       // tab indicator
    puck:  'cubic-bezier(0.34, 1.56, 0.64, 1)',  // goal scored — hard hit, slight overshoot
    sheet: 'cubic-bezier(0.32, 0, 0.67, 0)',     // sheet slide up
  },
};

const tokens = { colors, C, font, type, space, radii, shadows, motion };
export default tokens;
