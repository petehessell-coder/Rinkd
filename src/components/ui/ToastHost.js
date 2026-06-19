import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { colors, C, radii, shadows, motion, font } from '../../lib/tokens';
import { prefersReducedMotion } from '../../lib/motion';

// =============================================================================
// Toast / Undo host. Manifesto "Arena Analogy › Notification = goal-horn
// moment": bold, red-accented, feels like something just happened — not a
// subtle banner. Pairs with optimistic actions (delete a chirp → toast with
// Undo) so a lightweight action never needs a confirm dialog.
//
// Usage — mount the provider once near the app root:
//   <ToastProvider><App /></ToastProvider>
//
// Then anywhere beneath it:
//   const { toast } = useToast();
//   toast('Chirp posted');
//   toast({ message: 'Chirp deleted', undo: () => restore(), tone: 'alert' });
//
// `toast()` returns an id; `dismiss(id)` closes it early. Auto-dismiss is
// longer when an Undo is offered (you need time to catch it).
// =============================================================================
const ToastContext = createContext(null);

// Monotonic id — module scope so it survives provider re-renders.
let _seq = 0;

const TONES = {
  default: C.red,   // goal-horn red accent — "something happened"
  alert:   C.red,
  success: C.gold,  // milestone / win
  info:    C.blue,
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const clearTimer = useCallback((id) => {
    if (timers.current[id]) { clearTimeout(timers.current[id]); delete timers.current[id]; }
  }, []);

  const remove = useCallback((id) => {
    clearTimer(id);
    setToasts((list) => list.filter((t) => t.id !== id));
  }, [clearTimer]);

  // Animate out, then remove. Reduced motion removes immediately.
  const dismiss = useCallback((id) => {
    clearTimer(id);
    if (prefersReducedMotion()) { remove(id); return; }
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    window.setTimeout(() => remove(id), motion.duration.exit);
  }, [clearTimer, remove]);

  const toast = useCallback((opts) => {
    const o = typeof opts === 'string' ? { message: opts } : (opts || {});
    const id = ++_seq;
    const duration = o.duration != null ? o.duration : (o.undo ? 6000 : 3500);
    const entry = {
      id,
      message: o.message || '',
      tone: o.tone || 'default',
      icon: o.icon,
      undo: typeof o.undo === 'function' ? o.undo : null,
      actionLabel: o.actionLabel || 'Undo',
      leaving: false,
    };
    setToasts((list) => [...list, entry]);
    if (duration > 0) timers.current[id] = window.setTimeout(() => dismiss(id), duration);
    return id;
  }, [dismiss]);

  const fireUndo = useCallback((t) => {
    try { t.undo && t.undo(); } finally { remove(t.id); }
  }, [remove]);

  // Clear every pending timer if the provider ever unmounts.
  useEffect(() => () => { Object.keys(timers.current).forEach((k) => clearTimeout(timers.current[k])); }, []);

  const ctx = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} onUndo={fireUndo} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  // Fail safe: if a component calls useToast() with no provider mounted, return
  // no-ops rather than crashing the screen. (Mount <ToastProvider> to enable.)
  if (!ctx) return NOOP;
  return ctx;
}
const NOOP = { toast: () => -1, dismiss: () => {} };

// -----------------------------------------------------------------------------
// useUndoable — the manifesto's "optimistic action + Undo, never a confirm
// dialog." Returns a runner you call instead of window.confirm:
//
//   const runUndoable = useUndoable();
//   runUndoable({
//     message: 'Post deleted',
//     apply:  () => { removeFromUI(); return () => putItBack(); }, // optimistic; returns restore
//     commit: () => deletePost(id),                               // the real (often irreversible) write
//   });
//
// The UI updates instantly; a 5-second Undo toast appears; the irreversible
// commit fires ONLY after those 5s elapse. Tapping Undo cancels the commit and
// restores the UI. If the commit fails, we restore the UI and surface it — the
// user never silently loses their thing.
// -----------------------------------------------------------------------------
const UNDO_MS = 5000;
export function useUndoable() {
  const { toast, dismiss } = useToast();
  return useCallback(({ message, apply, commit, errorMessage, actionLabel = 'Undo', tone = 'alert', icon }) => {
    let restore = null;
    try { restore = typeof apply === 'function' ? apply() : null; } catch { return; }
    const doRestore = () => { if (typeof restore === 'function') { try { restore(); } catch { /* noop */ } } };

    // `settled` makes Undo-vs-commit a clean check-and-set. JS is single-threaded,
    // so whichever path runs first wins and the other is a no-op — the irreversible
    // commit can NEVER race a late Undo tap during the toast's fade-out. useUndoable
    // owns the toast lifecycle (manual dismiss + commit), so the auto-dismiss timer
    // can't fire the commit as the button is still disappearing (the old bug).
    let settled = false;
    let timer = null;
    const id = toast({
      message, tone, icon, actionLabel,
      duration: 0, // we dismiss it ourselves, in lock-step with the commit
      undo: () => { if (settled) return; settled = true; clearTimeout(timer); dismiss(id); doRestore(); },
    });
    timer = setTimeout(async () => {
      if (settled) return;
      settled = true;
      dismiss(id); // pull the (now non-undoable) toast before the irreversible write
      try { await (typeof commit === 'function' ? commit() : null); }
      catch {
        doRestore();
        toast({ message: errorMessage || "That didn’t go through — it’s back where it was. Try again.", tone: 'alert' });
      }
    }, UNDO_MS);
  }, [toast, dismiss]);
}

// -----------------------------------------------------------------------------
// Viewport — fixed, bottom-center, stacked. Sits above everything; passes
// pointer events through the gaps so it never blocks the UI underneath.
// -----------------------------------------------------------------------------
function ToastViewport({ toasts, onDismiss, onUndo }) {
  ensureKeyframes();
  if (!toasts.length) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed', left: '50%', transform: 'translateX(-50%)',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 76px)', // clears the bottom nav
        zIndex: 9000,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        width: 'min(440px, calc(100vw - 24px))',
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <ToastRow key={t.id} t={t} onDismiss={onDismiss} onUndo={onUndo} />
      ))}
    </div>
  );
}

function ToastRow({ t, onDismiss, onUndo }) {
  const accent = TONES[t.tone] || TONES.default;
  return (
    <div
      className={t.leaving ? 'rinkd-toast rinkd-toast-out' : 'rinkd-toast'}
      style={{
        pointerEvents: 'auto',
        width: '100%', minWidth: 0,
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 12px 12px 14px',
        background: colors.surfaceElevated,
        borderLeft: `4px solid ${accent}`,
        border: `1px solid ${C.border}`, borderLeftWidth: 4, borderLeftColor: accent,
        borderRadius: radii.card,
        boxShadow: shadows.hover,
      }}
    >
      {t.icon != null && <span style={{ flexShrink: 0, fontSize: 18, lineHeight: 1 }}>{t.icon}</span>}
      <span
        style={{
          flex: 1, minWidth: 0,
          fontFamily: font.body, fontSize: 14, fontWeight: 600, color: C.ice, lineHeight: 1.35,
          // Clamp to two lines so a long message can't grow the toast unbounded.
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}
      >
        {t.message}
      </span>

      {t.undo && (
        <button
          onClick={() => onUndo(t)}
          style={{
            flexShrink: 0, minHeight: 44, padding: '0 12px',
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontFamily: font.display, fontWeight: 900, fontStyle: 'italic',
            fontSize: 13, letterSpacing: '0.04em', textTransform: 'uppercase',
            color: accent, WebkitTapHighlightColor: 'transparent',
          }}
        >
          {t.actionLabel}
        </button>
      )}

      <button
        onClick={() => onDismiss(t.id)}
        aria-label="Dismiss"
        style={{
          flexShrink: 0, width: 44, height: 44, marginRight: -6,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: C.steel, fontSize: 18, lineHeight: 1, WebkitTapHighlightColor: 'transparent',
        }}
      >
        ✕
      </button>
    </div>
  );
}

let injected = false;
function ensureKeyframes() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const el = document.createElement('style');
  el.textContent =
    `@keyframes rinkdToastIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}` +
    `@keyframes rinkdToastOut{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(8px)}}` +
    `.rinkd-toast{animation:rinkdToastIn ${motion.duration.entrance}ms ${motion.easing.out} both}` +
    `.rinkd-toast-out{animation:rinkdToastOut ${motion.duration.exit}ms ${motion.easing.in} both}` +
    `@media (prefers-reduced-motion: reduce){.rinkd-toast,.rinkd-toast-out{animation:none}}`;
  document.head.appendChild(el);
}
