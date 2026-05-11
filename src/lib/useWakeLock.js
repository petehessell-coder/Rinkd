import { useEffect, useRef } from 'react';

/**
 * Holds a Screen Wake Lock for as long as the component is mounted. Used on
 * the scorer view so a phone propped on the bench never sleeps during a game.
 *
 * The browser releases the wake lock automatically when the tab backgrounds.
 * We listen for visibility changes and re-request it when the tab returns.
 *
 * No-op on browsers without the Wake Lock API (older iOS Safari, etc.) —
 * the call resolves silently so the caller doesn't need a try/catch.
 *
 * @param {boolean} enabled — pass false to release the lock without unmounting.
 */
export function useWakeLock(enabled = true) {
  const sentinelRef = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return undefined;

    let cancelled = false;

    const request = async () => {
      if (cancelled) return;
      if (document.visibilityState !== 'visible') return;
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        if (cancelled) {
          sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
        sentinel.addEventListener('release', () => {
          // The OS may have released the lock (backgrounded, locked, etc.).
          // Clear our ref so the visibility handler can re-request.
          if (sentinelRef.current === sentinel) sentinelRef.current = null;
        });
      } catch (e) {
        // NotAllowedError / SecurityError on insecure context, etc. — silent.
        // eslint-disable-next-line no-console
        console.warn('[wakeLock] request failed:', e?.name || e);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !sentinelRef.current) {
        request();
      }
    };

    request();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      if (sentinel) sentinel.release().catch(() => {});
    };
  }, [enabled]);
}
