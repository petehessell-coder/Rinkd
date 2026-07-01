import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ShareButton from './ShareButton';
import PuckMark from './PuckMark';
import { loadGamePuckCardData } from '../lib/gameCardData';
import { prefersReducedMotion } from '../lib/motion';
import { haptics } from '../lib/haptics';
import { C } from '../lib/tokens';

// GAMEPUCK-2 — the "peel the tape" reveal. A settled Game Puck winner sits UNDER
// a strip of worn hockey tape; you grab the loose end and drag across to peel it
// off, revealing the winner with a celebration. Pete's pick (Jun 8) of the
// hockey-native reveal — the most ownable. Pairs with the SOCIAL-3 30-min timed
// voting window (the tally is sealed in the final 10 min, so this IS a surprise).
//
// Interaction notes:
//   - Pointer Events (mouse + touch unified) with pointer capture; the stage is
//     touch-action:none so the drag never scrolls the feed behind the modal.
//   - peel ∈ 0..1 follows the finger's X across the stage. At ≥0.7 it auto-rips
//     to 1 (a real peel "lets go" near the end), fires confetti + an rrrip
//     haptic, and latches revealed.
//   - Reduced-motion / keyboard / no-pointer users get a "Reveal" button that
//     completes instantly (no animation, no confetti) — fully accessible.
//   - One-time per device: localStorage gp_revealed_<kind>_<gameId>. Re-opening
//     a game you've already revealed skips straight to the winner (the card
//     decides that; this modal always animates when mounted).
//
// Props:
//   gameId, kind                  the polymorphic game ref
//   result                        { jersey, winner_name, votes, total_votes }
//   teamName                      winning team's display name | null
//   winnerPucks                   the winner's career Game Puck count
//   accent                        accent color (default Rinkd red)
//   onClose()                     dismiss the modal
//   onRevealed()                  called once when the peel completes

// Local drift: no exact token match, kept inline per migration rules.
const GPR_DIM = 'rgba(244,247,250,0.6)';
const GPR_FAINT = 'rgba(244,247,250,0.35)';
const RIP_AT = 0.7;            // fraction peeled before it auto-finishes
const HAPTIC_STEPS = 8;        // "ticks per wrap" as the tape lifts

// ── The 3D roll ─────────────────────────────────────────────────────────────
// As the tape peels, its loose end lifts off the surface and curls back into a
// roll. We model that roll as a lit cylinder pinned to the lift line:
//   · its width (radius) GROWS with the peel — more tape rolled up = heavier,
//   · a horizontal gradient gives it cylinder shading (under-curl shadow → tan →
//     specular crown → front-face falloff → a rim catch-light at the lift edge),
//   · a fixed jagged RIGHT edge reads as an irregular, torn peel front,
//   · a soft cast shadow on the revealed ice grows + slides as it lifts,
//   · on the auto-rip it flings off-screen with weight (perspective + rotate).
// All of it is suppressed under reduced motion (the "Reveal" button path).

// Worn-tape cylinder shading, light from the upper-right. Stops chosen so the
// crown reads bright and the under-curl edge reads as deep shadow.
const CYL =
  'linear-gradient(90deg,' +
  'rgba(34,32,26,0.62) 0%,' +  // under-curl, tucked in shadow
  '#a8a08b 12%,' +             // rising tan off the shadow
  '#e9e2d0 34%,' +
  '#fffefa 49%,' +             // specular crown
  '#efe8d6 58%,' +
  '#c7bea6 78%,' +             // front-face falloff
  '#9a927c 93%,' +             // crease before the lift line
  '#e8e1cd 100%)';             // rim catch-light at the lift edge

// A fixed torn profile for the roll's right (lift) edge — % inset per node down
// the height. Deterministic so the tear looks consistent, not random per render.
const TEAR = [0.2, 1.5, 0.5, 2.1, 0.9, 1.7, 0.3, 2.0, 0.7, 1.3, 0.4, 1.6, 0.6];
function rollClip() {
  const n = TEAR.length;
  const pts = ['0% 0%', '0% 100%'];
  for (let i = n - 1; i >= 0; i--) {
    const y = (i / (n - 1)) * 100;
    pts.push(`${(100 - TEAR[i]).toFixed(1)}% ${y.toFixed(1)}%`);
  }
  return `polygon(${pts.join(',')})`;
}

// Inject the rip-fling keyframe once (reduced-motion safe — the fling never
// runs under reduced motion because the roll isn't rendered there).
const PEEL_KEYFRAMES_ID = 'gp-peel-keyframes';
function ensurePeelKeyframes() {
  if (typeof document === 'undefined' || document.getElementById(PEEL_KEYFRAMES_ID)) return;
  const el = document.createElement('style');
  el.id = PEEL_KEYFRAMES_ID;
  el.textContent =
    '@keyframes gpPeelFling{0%{transform:translateX(-100%) rotate(0deg) scale(1);opacity:1}' +
    '100%{transform:translateX(-260%) rotate(-26deg) scale(0.82);opacity:0}}';
  document.head.appendChild(el);
}

const revealKey = (kind, gameId) => `gp_revealed_${kind === 'league' ? 'league' : 'tournament'}_${gameId}`;
export function hasRevealed(kind, gameId) {
  try { return !!localStorage.getItem(revealKey(kind, gameId)); } catch { return false; }
}
function markRevealed(kind, gameId) {
  try { localStorage.setItem(revealKey(kind, gameId), '1'); } catch { /* private mode — fine */ }
}

// A tiny dependency-free confetti burst: ~46 chips fall + drift for ~1.4s, then
// the component unmounts itself. Colors lean Rinkd (red/ice/steel) + a little
// gold for the "trophy" pop. Keyframes are injected once.
const CONFETTI_KEYFRAMES_ID = 'gp-confetti-keyframes';
function ensureConfettiKeyframes() {
  if (typeof document === 'undefined' || document.getElementById(CONFETTI_KEYFRAMES_ID)) return;
  const el = document.createElement('style');
  el.id = CONFETTI_KEYFRAMES_ID;
  el.textContent = `@keyframes gpConfettiFall{0%{transform:translate3d(0,0,0) rotate(0deg);opacity:1}100%{transform:translate3d(var(--gp-dx),var(--gp-dy),0) rotate(var(--gp-rot));opacity:0}}`;
  document.head.appendChild(el);
}
function Confetti({ seed = 0 }) {
  ensureConfettiKeyframes();
  const COLORS = [C.red, C.ice, C.steel, '#F5B301', C.blue];
  // Deterministic pseudo-random from an index (Math.random is fine in the app,
  // but a seed keeps the burst stable across re-renders within its short life).
  const rnd = (i, salt) => {
    const x = Math.sin((i + 1) * 12.9898 + salt * 78.233 + seed * 3.71) * 43758.5453;
    return x - Math.floor(x);
  };
  const chips = useMemo(() => Array.from({ length: 46 }, (_, i) => {
    const angle = rnd(i, 1) * Math.PI - Math.PI / 2;       // upward-ish fan
    const dist = 120 + rnd(i, 2) * 260;
    return {
      left: 40 + rnd(i, 3) * 20,                            // start near top-center (%)
      dx: Math.cos(angle) * dist * (rnd(i, 4) > 0.5 ? 1 : -1),
      dy: 160 + rnd(i, 5) * 320,                            // gravity pull
      rot: (rnd(i, 6) * 720 - 360) + 'deg',
      delay: rnd(i, 7) * 90,
      w: 6 + Math.round(rnd(i, 8) * 6),
      h: 8 + Math.round(rnd(i, 9) * 8),
      color: COLORS[i % COLORS.length],
      round: rnd(i, 10) > 0.7,
    };
  }), [seed]);
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 5 }}>
      {chips.map((c, i) => (
        <span key={i} style={{
          position: 'absolute', top: '12%', left: `${c.left}%`,
          width: c.w, height: c.h, background: c.color,
          borderRadius: c.round ? '50%' : 1,
          // eslint-disable-next-line
          ['--gp-dx']: `${c.dx}px`, ['--gp-dy']: `${c.dy}px`, ['--gp-rot']: c.rot,
          animation: `gpConfettiFall 1.3s cubic-bezier(.21,.61,.35,1) ${c.delay}ms forwards`,
        }} />
      ))}
    </div>
  );
}

export default function GamePuckReveal({
  gameId, kind, result, teamName = null,
  winnerPucks = 0, accent = C.red, onClose, onRevealed,
}) {
  const stageRef = useRef(null);
  const draggingRef = useRef(false);
  const lastTickRef = useRef(0);
  const finishedRef = useRef(false);
  const ripTimerRef = useRef(null);
  const reduced = useMemo(prefersReducedMotion, []);
  const [peel, setPeel] = useState(0);          // 0 = fully taped, 1 = revealed
  const [done, setDone] = useState(false);       // reveal latched
  const [ripping, setRipping] = useState(false); // the tape is springing off + flinging
  const [confettiOn, setConfettiOn] = useState(false);
  const [tapeImgFailed, setTapeImgFailed] = useState(false); // real tape couldn't load → CSS fallback

  useEffect(() => { if (!reduced) ensurePeelKeyframes(); }, [reduced]);
  useEffect(() => () => clearTimeout(ripTimerRef.current), []);

  const name = result?.winner_name || null;
  const jersey = result?.jersey;
  const votes = result?.votes || 0;
  const totalVotes = result?.total_votes || 0;

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    draggingRef.current = false;
    if (!reduced) {
      // Weight + spring into the rip: the roll flings off while the flat tape's
      // clip springs from wherever it was to fully gone. `ripping` first makes
      // the spring transition the committed style; the clip value (→1) changes
      // a paint LATER (double rAF) so the browser actually animates it instead
      // of snapping (transition-added + value-changed in one frame won't tween).
      setRipping(true);
      haptics.rip();                 // rrrip
      setConfettiOn(true);
      const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
      raf(() => raf(() => { if (finishedRef.current) setPeel(1); }));
      ripTimerRef.current = setTimeout(() => setRipping(false), 560);
    } else {
      // Reduced motion: no animation, no confetti — instant reveal.
      setPeel(1);
    }
    setDone(true);
    markRevealed(kind, gameId);
    onRevealed && onRevealed();
  }, [reduced, kind, gameId, onRevealed]);

  const setFromClientX = useCallback((clientX) => {
    const el = stageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setPeel(frac);
    // Haptic tick each time we cross a "wrap" boundary while lifting.
    const step = Math.floor(frac * HAPTIC_STEPS);
    if (step !== lastTickRef.current) { lastTickRef.current = step; haptics.tick(); }
    if (frac >= RIP_AT) finish();
  }, [reduced, finish]);

  const onPointerDown = useCallback((e) => {
    if (done || reduced) return;
    draggingRef.current = true;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ok */ }
    setFromClientX(e.clientX);
  }, [done, reduced, setFromClientX]);

  const onPointerMove = useCallback((e) => {
    if (!draggingRef.current || done) return;
    setFromClientX(e.clientX);
  }, [done, setFromClientX]);

  const onPointerUp = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    // Released before the rip point — the tape springs back (you didn't commit).
    if (!finishedRef.current) { lastTickRef.current = 0; setPeel(0); }
  }, []);

  // Esc closes; lock background scroll while open.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; };
  }, [onClose]);

  const peelPct = Math.round(peel * 100);
  const tapeGone = peel >= 0.999;

  // ── Peel geometry (recomputed per render from `peel`) ──
  const lift = peel;                                  // 0 (flat) → 1 (off)
  const rollW = Math.round(22 + lift * 36);           // the roll fattens as it gathers tape (weight)
  const rollLeftPct = ripping ? Math.round(RIP_AT * 100) : peelPct; // freeze the roll at the rip point while it flings
  const showTape = !tapeGone || ripping;              // keep the flat tape mounted through the rip spring
  const showRoll = !reduced && (ripping || (!tapeGone && peel > 0.012));
  // Spring (overshoot) into the rip; smooth otherwise; nothing while the finger drives it.
  const tapeClipTransition = draggingRef.current ? 'none'
    : ripping ? 'clip-path 0.5s cubic-bezier(.5,.16,.3,1.25), -webkit-clip-path 0.5s cubic-bezier(.5,.16,.3,1.25)'
      : 'clip-path 0.45s cubic-bezier(.5,0,.2,1), -webkit-clip-path 0.45s cubic-bezier(.5,0,.2,1)';
  // Cast shadow on the revealed ice — grows + softens as the roll lifts higher.
  const shadeBlur = (2 + lift * 6).toFixed(1);
  const shadeOpacity = (0.16 + lift * 0.26).toFixed(2);

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Game Puck reveal"
      onClick={(e) => { if (e.target === e.currentTarget) onClose && onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(7,17,31,0.9)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        fontFamily: 'Barlow, sans-serif',
      }}
    >
      <div style={{ width: '100%', maxWidth: 408 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.ice }}>
            <PuckMark size={20} />
            <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: GPR_DIM }}>Game Puck</span>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', color: GPR_FAINT, fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: 4 }}>×</button>
        </div>

        {/* The stage: winner underneath, tape on top. */}
        <div
          ref={stageRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{
            position: 'relative', width: '100%', aspectRatio: '700 / 981',
            borderRadius: 16, overflow: 'hidden',
            border: `1px solid ${C.border}`, background: C.card,
            boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
            touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none',
            cursor: done || reduced ? 'default' : 'grab',
          }}
        >
          {/* ── Winner layer (revealed) ── */}
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 16, padding: 22, textAlign: 'center',
            background: `radial-gradient(120% 90% at 50% 18%, rgba(215,38,56,0.28), rgba(15,40,71,0) 55%), linear-gradient(180deg, rgba(11,31,58,0.55) 0%, rgba(11,31,58,0.82) 100%), url('/recap-card-bg3.jpg') center/cover no-repeat, ${C.card}`,
            backgroundColor: C.card,
          }}>
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.2em', color: GPR_FAINT, textTransform: 'uppercase' }}>Fans’ Pick</div>
            <div style={{
              transform: done ? 'scale(1)' : 'scale(0.94)', opacity: done ? 1 : 0.0,
              transition: done ? 'transform 0.5s cubic-bezier(.18,1.3,.4,1) 0.05s, opacity 0.35s ease 0.05s' : 'none',
              filter: 'drop-shadow(0 10px 22px rgba(0,0,0,0.55))',
            }}>
              <PuckMark size={196} />
            </div>
            <div style={{
              transform: done ? 'translateY(0)' : 'translateY(6px)', opacity: done ? 1 : 0,
              transition: done ? 'all 0.4s ease 0.18s' : 'none',
            }}>
              <div style={{ fontSize: 36, fontWeight: 900, fontStyle: 'italic', fontFamily: "'Barlow Condensed', sans-serif", color: C.ice, lineHeight: 1.02 }}>
                {name || `#${jersey}`}
                {name != null && <span style={{ marginLeft: 10, fontSize: 24, fontWeight: 700, fontStyle: 'normal', color: GPR_DIM }}>#{jersey}</span>}
              </div>
              {teamName && <div style={{ fontSize: 18, fontWeight: 600, color: GPR_DIM, marginTop: 5 }}>{teamName}</div>}
              <div style={{ fontSize: 14, color: GPR_FAINT, marginTop: 9 }}>
                {votes} of {totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}
                {winnerPucks > 1 && <span style={{ marginLeft: 8, color: accent, fontWeight: 800 }}>· {winnerPucks}× Game Puck</span>}
              </div>
            </div>
          </div>

          {confettiOn && <Confetti seed={peelPct} />}

          {/* ── Flat tape still stuck to the surface (right of the lift line).
               Clipped away from the left as the peel advances; the real frayed
               photo rides over the CSS gradient fallback. ── */}
          {showTape && (
            <div aria-hidden style={{
              position: 'absolute', inset: 0, zIndex: 4,
              clipPath: `inset(0 0 0 ${peelPct}%)`,
              WebkitClipPath: `inset(0 0 0 ${peelPct}%)`,
              transition: `${tapeClipTransition}`,
              // Behind the frayed/transparent parts of the real tape we want the
              // SAME navy as the card so the patch sits seamlessly (no rectangular
              // border). The CSS gradient is painted ONLY if the image fails.
              background: tapeImgFailed ? '#e9ecef' : C.card,
              backgroundImage: tapeImgFailed
                ? 'repeating-linear-gradient(90deg, rgba(0,0,0,0.045) 0 2px, rgba(0,0,0,0) 2px 13px),' +
                  'repeating-linear-gradient(0deg, rgba(0,0,0,0.05) 0 1px, rgba(255,255,255,0) 1px 22px),' +
                  'linear-gradient(180deg,#f3f4f6,#dfe3e8 55%,#cfd5dc)'
                : 'none',
            }}>
              {!tapeImgFailed && (
                <picture>
                  <source srcSet="/gamepuck/tape.webp" type="image/webp" />
                  <img
                    src="/gamepuck/tape.png" alt="" draggable={false}
                    onError={() => setTapeImgFailed(true)}
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', userSelect: 'none', pointerEvents: 'none' }}
                  />
                </picture>
              )}
              {/* label + grip hint, hidden once you start pulling */}
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 10, opacity: peel > 0.04 ? 0 : 1, transition: 'opacity 0.15s', zIndex: 1,
                textShadow: '0 1px 2px rgba(255,255,255,0.55)',
              }}>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 32, letterSpacing: '0.04em', color: '#2a2a26', textTransform: 'uppercase' }}>Game Puck</div>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: '#4a463c', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span aria-hidden style={{ fontSize: 16 }}>👉</span> Drag to peel the tape
                </div>
              </div>
            </div>
          )}

          {/* ── Cast shadow — the lifted roll throws a soft shadow onto the
               revealed ice, growing + sliding as it climbs. ── */}
          {showRoll && (
            <div aria-hidden style={{
              position: 'absolute', top: '4%', bottom: '4%', left: `${rollLeftPct}%`, width: rollW * 1.5, zIndex: 5,
              transform: `translateX(calc(-100% - ${Math.round(rollW * 0.35)}px))`,
              transition: draggingRef.current ? 'none' : 'left 0.45s cubic-bezier(.5,0,.2,1)',
              background: `linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(0,0,0,${shadeOpacity * 0.4}) 55%, rgba(0,0,0,${shadeOpacity}) 100%)`,
              filter: `blur(${shadeBlur}px)`, borderRadius: rollW,
              opacity: ripping ? 0 : 1,
            }} />
          )}

          {/* ── The 3D roll — the loose end lifted off the surface and curled
               back into a lit cylinder, pinned to the lift line. Flings off on
               the rip. ── */}
          {showRoll && (
            <div aria-hidden style={{
              position: 'absolute', top: 0, bottom: 0, left: `calc(${rollLeftPct}% + 2px)`, width: rollW, zIndex: 6,
              perspective: 800,
              transform: ripping ? undefined : 'translateX(-100%)',
              transition: draggingRef.current || ripping ? 'none' : 'left 0.45s cubic-bezier(.5,0,.2,1)',
              animation: ripping ? 'gpPeelFling 0.5s cubic-bezier(.4,.05,.6,1) forwards' : 'none',
            }}>
              <div style={{
                position: 'absolute', inset: '-3px 0', clipPath: rollClip(), WebkitClipPath: rollClip(),
                background: CYL, borderRadius: 2,
                transform: 'rotateY(-15deg)', transformOrigin: 'right center',
                boxShadow: 'inset 0 9px 13px rgba(255,255,255,0.22), inset 0 -11px 15px rgba(0,0,0,0.32)',
              }}>
                {/* top-down light + bottom shade across the cylinder length */}
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(255,255,255,0.24) 0%, rgba(255,255,255,0) 24%, rgba(0,0,0,0) 68%, rgba(0,0,0,0.2) 100%)' }} />
                {/* the specular band running down the crown of the roll */}
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: '44%', width: 3, background: 'rgba(255,255,255,0.9)', filter: 'blur(2px)' }} />
                {/* the crease where the tape leaves the surface (the lift line) */}
                <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 2, background: 'rgba(0,0,0,0.3)' }} />
              </div>
            </div>
          )}
        </div>

        {/* Controls under the stage */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 14 }}>
          {!done ? (
            <button
              onClick={finish}
              style={{
                background: accent, color: '#fff', border: 'none', borderRadius: 999,
                padding: '11px 26px', cursor: 'pointer',
                fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontStyle: 'italic',
                fontSize: 15, letterSpacing: '0.05em', textTransform: 'uppercase',
              }}
            >
              {reduced ? 'Reveal the winner' : 'Reveal'}
            </button>
          ) : (
            <>
              <ShareButton gameId={gameId} isLeague={kind === 'league'} cardType="gamepuck" variant="solid" label="Share"
                getCard={() => loadGamePuckCardData(gameId, kind === 'league')} />
              <button onClick={onClose} style={{
                background: 'transparent', color: GPR_DIM, border: `1px solid ${C.border}`, borderRadius: 999,
                padding: '10px 20px', cursor: 'pointer', fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 600,
              }}>Done</button>
            </>
          )}
        </div>
        <div style={{ textAlign: 'center', fontSize: 10.5, color: GPR_FAINT, marginTop: 8 }}>
          Fan vote — separate from any team or league award.
        </div>
      </div>
    </div>
  );
}
