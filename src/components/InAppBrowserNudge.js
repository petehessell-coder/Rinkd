import React, { useEffect, useState } from 'react';
import { isInAppBrowser } from '../lib/platform';
import { track } from '../lib/analytics';
import { C, colors } from '../lib/tokens';

/**
 * Shown only inside social in-app webviews (Instagram/Facebook/etc.), where
 * signup is unreliable — no autofill, and Cloudflare Turnstile (required for
 * signup) frequently won't validate. Analytics show this cohort converts at
 * ~0%, so we tell them how to get to their real browser. Renders null
 * everywhere else, so zero impact on normal users.
 */
export default function InAppBrowserNudge() {
  const [inApp] = useState(() => isInAppBrowser());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (inApp) track('inapp_nudge_shown', { ua: (navigator.userAgent || '').slice(0, 80) });
  }, [inApp]);

  if (!inApp) return null;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText('https://rinkd.app');
      setCopied(true);
      track('inapp_nudge_copy');
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // clipboard is blocked in some webviews — the manual instructions still apply
    }
  };

  return (
    <div role="alert" style={{
      background: 'rgba(245,158,11,0.12)', border: `1px solid ${colors.warning}66`,
      borderRadius: 12, padding: '12px 14px', marginBottom: 16, fontFamily: "'Barlow', sans-serif",
    }}>
      <div style={{ fontWeight: 700, color: colors.warning, fontSize: 13, marginBottom: 4 }}>
        Open in your browser to sign up
      </div>
      <div style={{ fontSize: 12.5, color: C.ice, lineHeight: 1.5 }}>
        You're in an in-app browser (Instagram / Facebook), where sign-up doesn't work reliably.
        Tap the <strong>•••</strong> menu at the top and choose <strong>“Open in browser”</strong> (Safari / Chrome) — or copy the link:
      </div>
      <button onClick={copyLink} style={{
        marginTop: 10, padding: '8px 16px', borderRadius: 999, border: `1px solid ${colors.warning}`,
        background: 'transparent', color: colors.warning, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
        fontFamily: 'inherit',
      }}>
        {copied ? 'Copied ✓ — paste in Safari/Chrome' : 'Copy rinkd.app'}
      </button>
    </div>
  );
}
