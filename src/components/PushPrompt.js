import React, { useEffect, useState } from 'react';
import { subscribeToPush, getPushState } from '../lib/push';
import { iosCanInstallButHasnt } from '../lib/platform';
import { IOS_INSTALL_EVENT } from './IOSInstallBanner';

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
  // On iOS Safari, web push can't be delivered until the PWA is installed to
  // the home screen — so the "Enable" tap must lead to the install banner, not
  // a subscribeToPush() that silently fails. Mirrors the Tournament Follow flow.
  const iosNeedsInstall = iosCanInstallButHasnt();

  useEffect(() => {
    getPushState().then(setState);
  }, []);

  if (dismissed) return null;
  if (state === 'loading' || state === 'unsupported' || state === 'subscribed' || state === 'denied') return null;

  const handleEnable = async () => {
    if (iosNeedsInstall) {
      // Surface the "Add to Home Screen" banner (which explains how) instead of
      // calling subscribeToPush, which would silently fail on un-installed iOS
      // Safari and leave the user believing they'd enabled alerts.
      window.dispatchEvent(new CustomEvent(IOS_INSTALL_EVENT));
      handleDismiss();
      return;
    }
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
          {iosNeedsInstall
            ? 'Add Rinkd to your home screen to get game-day alerts on iPhone — tap below to see how.'
            : 'Get a quick ping when your team has a game tomorrow, your RSVP is needed, or a teammate replies.'}
        </div>
      </div>
      <button onClick={handleDismiss}
        style={{ padding: '6px 12px', borderRadius: 999, background: 'transparent', border: `1px solid ${B.border}`, color: B.steel, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
        Not now
      </button>
      <button onClick={handleEnable} disabled={busy}
        style={{ padding: '7px 14px', borderRadius: 999, background: busy ? B.border : B.red, border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
        {iosNeedsInstall ? '📲 Add to Home Screen' : (busy ? 'Enabling…' : '🔔 Enable')}
      </button>
    </div>
  );
}
