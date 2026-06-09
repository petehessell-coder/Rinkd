import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from './Logos';
import ShareButton from './ShareButton';
import { loadGamePuckCardData } from '../lib/gameCardData';

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
//   winnerProfile                 profiles row | null (nameplate-only)
//   teamName                      winning team's display name | null
//   winnerPucks                   the winner's career Game Puck count
//   accent                        accent color (default Rinkd red)
//   onClose()                     dismiss the modal
//   onRevealed()                  called once when the peel completes

const C = {
  card: '#0f2847', ice: '#F4F7FA', border: 'rgba(46,91,140,0.4)',
  dim: 'rgba(244,247,250,0.6)', faint: 'rgba(244,247,250,0.35)',
};
const RIP_AT = 0.7;            // fraction peeled before it auto-finishes
const HAPTIC_STEPS = 8;        // "ticks per wrap" as the tape lifts

const prefersReducedMotion = () => {
  try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
};
const buzz = (pattern) => { try { navigator.vibrate && navigator.vibrate(pattern); } catch { /* no-op */ } };

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
  const COLORS = ['#D72638', '#F4F7FA', '#8BA3BE', '#F5B301', '#2E5B8C'];
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
  gameId, kind, result, winnerProfile = null, teamName = null,
  winnerPucks = 0, accent = '#D72638', onClose, onRevealed,
}) {
  const stageRef = useRef(null);
  const draggingRef = useRef(false);
  const lastTickRef = useRef(0);
  const finishedRef = useRef(false);
  const reduced = useMemo(prefersReducedMotion, []);
  const [peel, setPeel] = useState(0);          // 0 = fully taped, 1 = revealed
  const [done, setDone] = useState(false);       // reveal latched
  const [confettiOn, setConfettiOn] = useState(false);

  const name = result?.winner_name || winnerProfile?.name || null;
  const jersey = result?.jersey;
  const votes = result?.votes || 0;
  const totalVotes = result?.total_votes || 0;

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    draggingRef.current = false;
    setPeel(1);
    setDone(true);
    if (!reduced) { buzz([0, 28, 18, 42]); setConfettiOn(true); }   // rrrip
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
    if (step !== lastTickRef.current) { lastTickRef.current = step; if (!reduced) buzz(6); }
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
      <div style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.ice }}>
            <span aria-hidden style={{ width: 13, height: 13, borderRadius: '50%', background: '#0a0a0a', border: '1.5px solid rgba(244,247,250,0.4)' }} />
            <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.dim }}>Game Puck</span>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', color: C.faint, fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: 4 }}>×</button>
        </div>

        {/* The stage: winner underneath, tape on top. */}
        <div
          ref={stageRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{
            position: 'relative', width: '100%', aspectRatio: '5 / 6',
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
            alignItems: 'center', justifyContent: 'center', gap: 12, padding: 22, textAlign: 'center',
            background: `radial-gradient(120% 90% at 50% 18%, rgba(215,38,56,0.20), rgba(15,40,71,0) 60%), ${C.card}`,
          }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.16em', color: C.faint, textTransform: 'uppercase' }}>Fans’ Pick</div>
            <div style={{
              transform: done ? 'scale(1)' : 'scale(0.94)', opacity: done ? 1 : 0.0,
              transition: done ? 'transform 0.5s cubic-bezier(.18,1.3,.4,1) 0.05s, opacity 0.35s ease 0.05s' : 'none',
            }}>
              {winnerProfile
                ? <Avatar profile={winnerProfile} size={104} />
                : (
                  <div aria-hidden style={{
                    width: 104, height: 104, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'linear-gradient(160deg,#1b3a5e,#0f2847)', border: `2px solid ${accent}`,
                    color: C.ice, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontStyle: 'italic', fontSize: 38,
                  }}>#{jersey}</div>
                )}
            </div>
            <div style={{
              transform: done ? 'translateY(0)' : 'translateY(6px)', opacity: done ? 1 : 0,
              transition: done ? 'all 0.4s ease 0.18s' : 'none',
            }}>
              <div style={{ fontSize: 22, fontWeight: 900, fontStyle: 'italic', fontFamily: "'Barlow Condensed', sans-serif", color: C.ice, lineHeight: 1.05 }}>
                {name || `#${jersey}`}
                {name != null && <span style={{ marginLeft: 7, fontSize: 16, fontWeight: 700, fontStyle: 'normal', color: C.dim }}>#{jersey}</span>}
              </div>
              {teamName && <div style={{ fontSize: 13, color: C.dim, marginTop: 3 }}>{teamName}</div>}
              <div style={{ fontSize: 11.5, color: C.faint, marginTop: 7 }}>
                {votes} of {totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}
                {winnerPucks > 1 && <span style={{ marginLeft: 8, color: accent, fontWeight: 800 }}>· {winnerPucks}× Game Puck</span>}
              </div>
            </div>
          </div>

          {confettiOn && <Confetti seed={peelPct} />}

          {/* ── Tape layer (cover) — clipped away from the left as you peel right ── */}
          {!tapeGone && (
            <div aria-hidden style={{
              position: 'absolute', inset: 0, zIndex: 4,
              clipPath: `inset(0 0 0 ${peelPct}%)`,
              WebkitClipPath: `inset(0 0 0 ${peelPct}%)`,
              transition: draggingRef.current ? 'none' : 'clip-path 0.45s cubic-bezier(.5,0,.2,1), -webkit-clip-path 0.45s cubic-bezier(.5,0,.2,1)',
              background: '#e9ecef',
              backgroundImage:
                'repeating-linear-gradient(90deg, rgba(0,0,0,0.045) 0 2px, rgba(0,0,0,0) 2px 13px),' +
                'repeating-linear-gradient(0deg, rgba(0,0,0,0.05) 0 1px, rgba(255,255,255,0) 1px 22px),' +
                'linear-gradient(180deg,#f3f4f6,#dfe3e8 55%,#cfd5dc)',
            }}>
              {/* worn smudges */}
              <div style={{ position: 'absolute', top: '22%', left: '12%', width: 60, height: 30, borderRadius: '50%', background: 'rgba(0,0,0,0.06)', filter: 'blur(6px)' }} />
              <div style={{ position: 'absolute', bottom: '18%', right: '16%', width: 80, height: 26, borderRadius: '50%', background: 'rgba(0,0,0,0.05)', filter: 'blur(7px)' }} />
              {/* label + grip hint, hidden once you start pulling */}
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 10, opacity: peel > 0.04 ? 0 : 1, transition: 'opacity 0.15s',
              }}>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 30, letterSpacing: '0.04em', color: '#2a3340', textTransform: 'uppercase' }}>Game Puck</div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: '#5b6776', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span aria-hidden style={{ fontSize: 16 }}>👉</span> Drag to peel the tape
                </div>
              </div>
            </div>
          )}

          {/* ── Curl lip — the lifting edge that tracks the peel boundary ── */}
          {!tapeGone && peel > 0.012 && (
            <div aria-hidden style={{
              position: 'absolute', top: 0, bottom: 0, left: `${peelPct}%`, width: 22, zIndex: 6,
              transform: 'translateX(-100%)',
              transition: draggingRef.current ? 'none' : 'left 0.45s cubic-bezier(.5,0,.2,1)',
            }}>
              {/* shadow the lifted tape casts onto the revealed side */}
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: -14, width: 16, background: 'linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.28) 100%)', filter: 'blur(1px)' }} />
              {/* the curled tape edge */}
              <div style={{
                position: 'absolute', top: -2, bottom: -2, right: 0, width: 22,
                borderRadius: '3px 9px 9px 3px',
                background: 'linear-gradient(90deg,#cfd5dc 0%,#eef1f4 45%,#ffffff 72%,#dfe3e8 100%)',
                boxShadow: '0 0 6px rgba(0,0,0,0.35), inset -2px 0 2px rgba(255,255,255,0.8)',
                transform: 'skewY(-1.5deg)',
              }} />
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
                background: 'transparent', color: C.dim, border: `1px solid ${C.border}`, borderRadius: 999,
                padding: '10px 20px', cursor: 'pointer', fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 600,
              }}>Done</button>
            </>
          )}
        </div>
        <div style={{ textAlign: 'center', fontSize: 10.5, color: C.faint, marginTop: 8 }}>
          Fan vote — separate from any team or league award.
        </div>
      </div>
    </div>
  );
}
