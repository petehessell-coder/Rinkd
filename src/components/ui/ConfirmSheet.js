import React, { useEffect, useState, useCallback } from 'react';
import { C, colors, motion, radii } from '../../lib/tokens';
import Button from './Button';

// =============================================================================
// ConfirmSheet — the branded replacement for window.confirm (S10 D-S10-1).
//
// For IRREVERSIBLE, high-blast actions only (schedule regen, disconnect,
// role removal). Reversible deletes should use useUndoable instead — optimistic
// + Undo beats any confirm. If you're confirming something undo-able, you're
// using the wrong primitive.
//
// Two ways to use:
//
//   // 1. Imperative hook — reads like window.confirm:
//   const confirm = useConfirm();
//   const onRegen = async () => {
//     if (!(await confirm({
//       title: 'Regenerate the schedule?',
//       body: 'This wipes all 42 unplayed games and rebuilds them.',
//       confirmLabel: 'Regenerate',
//       danger: true,
//     }))) return;
//     ...do it
//   };
//   // render: <ConfirmSheetHost controller={confirm} /> once in the page.
//
//   // 2. Controlled component:
//   <ConfirmSheet open={open} title=... body=... onConfirm=... onCancel=... />
//
// Motion: centered panel fade + rise at entrance/out (mirrors the S09 modal
// pattern), reduced-motion static. Escape + backdrop-tap cancel. The confirm
// button is the ONLY red element (danger) — color intent preserved.
// =============================================================================

let injected = false;
function ensureKeyframes() {
  if (injected || typeof document === 'undefined') return;
  if (document.getElementById('rinkd-confirm-anim')) { injected = true; return; }
  injected = true;
  const el = document.createElement('style');
  el.id = 'rinkd-confirm-anim';
  el.textContent =
    '@keyframes rinkdConfirmOverlay{from{opacity:0}to{opacity:1}}'
    + '@keyframes rinkdConfirmPanel{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}'
    + `.rinkd-confirm-overlay{animation:rinkdConfirmOverlay ${motion.duration.exit}ms ${motion.easing.out} both}`
    + `.rinkd-confirm-panel{animation:rinkdConfirmPanel ${motion.duration.entrance}ms ${motion.easing.out} both}`
    + '@media (prefers-reduced-motion: reduce){.rinkd-confirm-overlay,.rinkd-confirm-panel{animation:none}}';
  document.head.appendChild(el);
}

export default function ConfirmSheet({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  busy = false,        // confirm in flight — disables both buttons
  onConfirm,
  onCancel,
}) {
  ensureKeyframes();

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onCancel?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="rinkd-confirm-overlay"
      onClick={busy ? undefined : onCancel}
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: 'fixed', inset: 0, zIndex: 10500,
        background: 'rgba(7,17,31,0.8)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, fontFamily: "'Barlow', sans-serif",
      }}
    >
      <div
        className="rinkd-confirm-panel"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 400,
          background: colors.surface, border: `1px solid ${C.border}`,
          borderRadius: radii.card, padding: 20,
          boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{
          fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900,
          fontSize: 22, lineHeight: 1.1, textTransform: 'uppercase', color: C.ice, marginBottom: 8,
        }}>
          {title}
        </div>
        {body && (
          <div style={{ fontSize: 14, color: C.steel, lineHeight: 1.55, marginBottom: 18 }}>{body}</div>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'primary' : 'secondary'} size="sm" onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * useConfirm — window.confirm ergonomics on the branded sheet.
 * Returns a callable that resolves true/false; render <ConfirmSheetHost
 * controller={confirm} /> once in the same component.
 */
export function useConfirm() {
  const [state, setState] = useState(null); // { opts, resolve } | null
  const ask = useCallback((opts) => new Promise((resolve) => {
    setState({ opts: opts || {}, resolve });
  }), []);
  ask._state = state;
  ask._close = useCallback((result) => {
    setState((s) => { s?.resolve(result); return null; });
  }, []);
  return ask;
}

export function ConfirmSheetHost({ controller }) {
  const state = controller?._state;
  if (!state) return null;
  const { opts } = state;
  return (
    <ConfirmSheet
      open
      title={opts.title || 'Are you sure?'}
      body={opts.body}
      confirmLabel={opts.confirmLabel || 'Confirm'}
      cancelLabel={opts.cancelLabel || 'Cancel'}
      danger={opts.danger !== false}
      onConfirm={() => controller._close(true)}
      onCancel={() => controller._close(false)}
    />
  );
}
