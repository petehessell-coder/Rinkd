import { useEffect, useRef } from 'react';

const SITE_KEY = process.env.REACT_APP_TURNSTILE_SITE_KEY;

/**
 * Cloudflare Turnstile bot-protection widget. Renders the challenge frame and
 * fires onToken(token) once the visitor passes. The token is short-lived
 * (~5 min) and must be passed to the server-side action — for Supabase Auth
 * that's supabase.auth.signUp({ options: { captchaToken: token } }).
 *
 * If REACT_APP_TURNSTILE_SITE_KEY isn't set, the widget renders nothing and
 * onToken is never called. That lets callers either: (a) require a token
 * unconditionally (production, with the env var set) or (b) treat its absence
 * as "no widget configured, allow through" (dev / preview).
 *
 * The Turnstile script tag (`<script src="https://challenges.cloudflare.com/
 * turnstile/v0/api.js" async defer />`) lives in public/index.html so it loads
 * once per page and stays ready for any widget on the page.
 */
export default function TurnstileWidget({ onToken, onError, theme = 'dark' }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const onTokenRef = useRef(onToken);
  const onErrorRef = useRef(onError);

  // Keep the callback refs current without forcing the widget to re-render.
  useEffect(() => { onTokenRef.current = onToken; }, [onToken]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  useEffect(() => {
    if (!SITE_KEY || !containerRef.current) return undefined;

    let cancelled = false;
    let pollInterval = null;

    const renderWidget = () => {
      if (cancelled || !window.turnstile || !containerRef.current) return;
      try {
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: SITE_KEY,
          theme,
          callback: (token) => onTokenRef.current?.(token),
          'error-callback': () => onErrorRef.current?.('verify_failed'),
          'expired-callback': () => onTokenRef.current?.(null),
          'timeout-callback': () => onTokenRef.current?.(null),
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[turnstile] render failed:', err);
        onErrorRef.current?.('render_failed');
      }
    };

    if (window.turnstile) {
      renderWidget();
    } else {
      // Script is loading from index.html. Poll briefly for it.
      pollInterval = setInterval(() => {
        if (window.turnstile) {
          clearInterval(pollInterval);
          pollInterval = null;
          renderWidget();
        }
      }, 100);
    }

    return () => {
      cancelled = true;
      if (pollInterval) clearInterval(pollInterval);
      if (widgetIdRef.current && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current); } catch { /* swallow */ }
        widgetIdRef.current = null;
      }
    };
  }, [theme]);

  if (!SITE_KEY) return null;
  return <div ref={containerRef} style={{ marginTop: 12 }} />;
}

/** True when the Turnstile site key is configured for this build. */
export const isTurnstileEnabled = !!SITE_KEY;
