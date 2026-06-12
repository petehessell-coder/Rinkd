/**
 * Sentry wrapper.
 *
 * Stays completely dormant until REACT_APP_SENTRY_DSN is set in Vercel env.
 * That way developers can clone the repo, build, and run locally without
 * needing a Sentry account or seeing init errors — and we never accidentally
 * fire localhost traffic at the production Sentry project.
 *
 * Once the DSN is configured:
 *   - Unhandled exceptions and promise rejections are captured automatically
 *   - Our ErrorBoundary calls Sentry.captureException with the React component stack
 *   - User context (user_id) is set after auth so we can correlate errors to accounts
 *   - Release tagged with the build SHA so we can correlate errors to deploys
 *   - 10% performance trace sample rate (well under free-tier budget)
 */

import * as Sentry from '@sentry/react';

const DSN = process.env.REACT_APP_SENTRY_DSN;
// The build SHA we stamped into the service worker is exposed for free here too.
const RELEASE = process.env.REACT_APP_VERCEL_GIT_COMMIT_SHA?.slice(0, 12)
  || process.env.REACT_APP_BUILD_ID
  || 'local';

let initialized = false;

export function initSentry() {
  if (initialized) return;
  if (!DSN) return;
  if (typeof window === 'undefined') return;
  if (window.location?.hostname === 'localhost') return;

  try {
    Sentry.init({
      dsn: DSN,
      release: RELEASE,
      environment: window.location?.hostname === 'rinkd.app' ? 'production' : 'preview',
      integrations: [
        Sentry.browserTracingIntegration(),
      ],
      // Performance — keep it cheap on the free tier
      tracesSampleRate: 0.1,
      // Ignore third-party noise + intentional throws from extensions
      ignoreErrors: [
        'ResizeObserver loop',
        'Non-Error promise rejection captured',
        'top.GLOBALS',
        'NetworkError when attempting to fetch resource',
        'AbortError',
      ],
      denyUrls: [
        /chrome-extension:\/\//,
        /moz-extension:\/\//,
      ],
      beforeSend(event) {
        // Drop events that originated outside our domain (e.g. injected scripts)
        const frame = event.exception?.values?.[0]?.stacktrace?.frames?.find?.((f) => f.filename);
        if (frame?.filename?.startsWith('chrome-extension://')) return null;
        if (frame?.filename?.startsWith('moz-extension://')) return null;
        return event;
      },
    });
    initialized = true;
  } catch (err) {
    // Init should never crash the app — if Sentry itself is broken, swallow.
    // eslint-disable-next-line no-console
    console.warn('[sentry] init failed', err);
  }
}

export function setSentryUser(user, profile) {
  if (!initialized) return;
  if (!user) {
    try { Sentry.setUser(null); } catch { /* swallow */ }
    return;
  }
  try {
    Sentry.setUser({
      id: user.id,
      // We intentionally omit email — Sentry's "user" object surfaces in the
      // dashboard and we'd rather not parade real emails for debugging convenience.
      username: profile?.handle || undefined,
    });
  } catch { /* swallow */ }
}

export function captureException(err, context) {
  if (!initialized) return;
  try { Sentry.captureException(err, { extra: context }); } catch { /* swallow */ }
}

export function captureMessage(msg, level) {
  if (!initialized) return;
  try { Sentry.captureMessage(msg, level || 'info'); } catch { /* swallow */ }
}

// Report a swallowed data-fetch / query failure — the class that previously
// went invisible: a page catches a Supabase/PostgREST error, shows a "Retry"
// UI, and never tells us (e.g. the Jun-12 embed-ambiguity break after the REG
// FK repoints). Skips offline/network noise so we only hear about REAL bugs
// (broken embeds, missing columns, RPC signature mismatches — the "DB ahead of
// frontend" class). No-ops until the DSN is set, like everything else here.
const DATA_ERROR_NETWORKISH = /failed to fetch|networkerror|load failed|fetch failed|aborterror|timed? ?out|offline/i;
export function captureDataError(err, context) {
  if (!initialized) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const msg = (err && (err.message || err.error_description || String(err))) || '';
  if (DATA_ERROR_NETWORKISH.test(msg)) return;
  try {
    Sentry.captureException(err instanceof Error ? err : new Error(msg || 'data error'), {
      tags: { kind: 'data_fetch' },
      extra: { ...context, pgrst_code: err?.code, pgrst_details: err?.details, pgrst_hint: err?.hint },
    });
  } catch { /* swallow */ }
}

export const isSentryEnabled = () => initialized;
