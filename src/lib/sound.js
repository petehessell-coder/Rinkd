// SHARE-GOAL-1 — the goal horn.
//
// OPT-IN and MUTED BY DEFAULT (localStorage `rinkd_goal_horn`, default off). The
// horn is SYNTHESIZED with the Web Audio API — there's no audio file to ship,
// it works offline, and it costs nothing at the edge.
//
// Mobile autoplay policy: a page can't make sound until a user gesture unlocks
// the AudioContext. That's a feature here — the very tap that flips the opt-in
// toggle IS that gesture, so `setGoalHornEnabled(true)` unlocks + previews in one
// move, and every later goal can then play with no further interaction.
//
//   import { goalHornEnabled, setGoalHornEnabled, playGoalHorn } from '../lib/sound';

const KEY = 'rinkd_goal_horn';

function read() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

let enabled = read();
let ctx = null;

export function supportsSound() {
  try { return typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext); }
  catch { return false; }
}

export function goalHornEnabled() { return enabled; }

function getCtx() {
  if (ctx) return ctx;
  const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  try { ctx = new AC(); } catch { ctx = null; }
  return ctx;
}

// Resume a suspended context (must be called from within a user gesture the
// first time). Safe to call repeatedly.
export function unlockSound() {
  const c = getCtx();
  if (c && c.state === 'suspended') { try { c.resume(); } catch { /* ignore */ } }
  return !!c;
}

// Flip the opt-in. Turning ON unlocks the audio context from the calling gesture
// and previews the horn so the user immediately hears what they enabled.
export function setGoalHornEnabled(on) {
  enabled = !!on;
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* runtime flag still holds */ }
  if (on) { unlockSound(); playGoalHorn({ force: true }); }
  // Let any other mounted toggle (e.g. a second live card) re-sync its icon.
  try { window.dispatchEvent(new Event('rinkd-goalhorn-change')); } catch { /* SSR / no window */ }
}

// One arena air-horn blast: a low brass chord (A2/A3/C#4/E4) through a moving
// low-pass, with a quick attack, a held body, and a soft tail — roughly 1.3s.
// Peak gain is deliberately modest so it punctuates, never blasts.
function hornBlast(c) {
  const now = c.currentTime;
  const dur = 1.3;

  const master = c.createGain();
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(0.22, now + 0.05);  // hard attack
  master.gain.setValueAtTime(0.22, now + 0.95);                // held body
  master.gain.exponentialRampToValueAtTime(0.0001, now + dur); // release tail

  // A gentle low-pass that opens on the attack and closes on the tail gives the
  // blast its "blaaat" shape instead of a flat buzz.
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(380, now);
  lp.frequency.linearRampToValueAtTime(1700, now + 0.08);
  lp.frequency.linearRampToValueAtTime(900, now + dur);
  lp.Q.value = 0.7;

  // Slight pitch swell at the very start — the air-horn "winding up".
  const freqs = [110, 220, 277.18, 329.63]; // A2, A3, C#4, E4 — a bright major triad over the root
  freqs.forEach((f, i) => {
    const o = c.createOscillator();
    o.type = i === 0 ? 'sawtooth' : 'square';
    o.frequency.setValueAtTime(f * 0.992, now);
    o.frequency.linearRampToValueAtTime(f, now + 0.12);       // swell into pitch
    o.detune.value = (i - 1.5) * 5;                            // a touch of chorus spread
    const g = c.createGain();
    g.gain.value = i === 0 ? 0.5 : 0.32 / i;                  // root loudest, harmonics taper
    o.connect(g); g.connect(lp);
    o.start(now);
    o.stop(now + dur + 0.05);
  });

  lp.connect(master);
  master.connect(c.destination);
}

// Play the horn. No-op unless enabled (pass { force:true } for the opt-in
// preview). Never throws — audio is a garnish, never a blocker.
export function playGoalHorn({ force = false } = {}) {
  if (!enabled && !force) return;
  const c = getCtx();
  if (!c) return;
  if (c.state === 'suspended') { try { c.resume(); } catch { /* ignore */ } }
  try { hornBlast(c); } catch { /* ignore */ }
}
