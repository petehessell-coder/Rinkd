import React, { useEffect, useState } from 'react';
import { subscribeToPush, getPushState } from '../lib/push';

const B = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638',
  ice: '#F4F7FA', steel: '#8BA3BE', card: '#112236', border: '#1E3A5C',
};

const DISMISS_KEY = 'rinkd_push_prompt_dismissed_v1';

/**
 * Soft "Enable notifications?" banner shown the first time a logged-in user
 * lands on Feed (or any page that mounts this). Dismissable; we never re-show
 * after dismiss (the toggle on Profile is the persistent UI for opt-in later).
 *
 * Hides itself when:
 *   - browser can't do push (display-mode irrelevant, but unsupported)
 *   - user is already subscribed
 *   - user explicitly denied at the OS level
 *   - user already dismissed this banner
 */
export default function PushPrompt({ userId }) {
  const [state, setState] = useState('loading');
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getPushState().then(setState);
  }, []);

  if (dismissed) return null;
  if (state === 'loading' || state === 'unsupported' || state === 'subscribed' || state === 'denied') return null;

  const handleEnable = async () => {
    setBusy(true);
    const sub = await subscribeToPush(userId);
    setBusy(false);
    if (sub) {
      setState('subscribed');
    } else {
      // User clicked deny on the OS prompt — collapse the banner
      handleDismiss();
    }
  };

  const handleDismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch {}
    setDismissed(true);
  };

  return (
    <div style={{
      background: B.navy, border: `1px solid ${B.border}`, borderRadius: 14,
      padding: '14px 16px', marginBottom: 16, color: B.ice,
      fontFamily: "'Barlow', sans-serif",
      display: 'flex', alignItems: 'center', gap: 14,
    }}>
      <div style={{ fontSize: 32, lineHeight: 1, flexShrink: 0 }}>🔔</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: "'Barlow Condensed', sans-serif",
          fontWeight: 900, fontStyle: 'italic', fontSize: 16,
          textTransform: 'uppercase', letterSpacing: '0.02em',
          marginBottom: 2,
        }}>Don't miss a game</div>
        <div style={{ fontSize: 13, color: B.steel, lineHeight: 1.4 }}>
          Get a quick ping when your team has a game tomorrow, your RSVP is needed, or a teammate replies.
        </div>
      </div>
      <button onClick={handleDismiss}
        style={{ padding: '6px 12px', borderRadius: 999, background: 'transparent', border: `1px solid ${B.border}`, color: B.steel, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
        Not now
      </button>
      <button onClick={handleEnable} disabled={busy}
        style={{ padding: '7px 14px', borderRadius: 999, background: busy ? B.border : B.red, border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
        {busy ? 'Enabling…' : '🔔 Enable'}
      </button>
    </div>
  );
}
