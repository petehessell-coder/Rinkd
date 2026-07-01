import React from 'react';
import { isChunkLoadError, reloadOnceForChunk } from '../lib/chunkReload';
import { C } from '../lib/tokens';

/**
 * Top-level error boundary. Without this, any uncaught render error blanks
 * the entire React tree and the user sees a black screen with zero context.
 * With this, they see a branded fallback + Reload button, and we get a clear
 * console log + analytics event to chase the bug.
 *
 * Stale-chunk-after-deploy errors are handled specially: they're benign (a new
 * build shipped), so we self-heal by reloading once and DON'T report them to
 * Sentry — otherwise every deploy spams the issue tracker. (lazyWithRetry
 * catches most before they reach here; this is the backstop for any other
 * dynamic import.)
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, isChunk: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error, isChunk: isChunkLoadError(error) };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    // Stale chunk after a deploy → reload once to the fresh build; skip the
    // Sentry/analytics noise. If we've already reloaded (still failing), fall
    // through and report it as a genuine error.
    if (isChunkLoadError(error) && reloadOnceForChunk()) return;
    // eslint-disable-next-line no-console
    console.error('[Rinkd] Caught error:', error, errorInfo);
    // Best-effort: fire to both Sentry (if configured) and our self-hosted
    // analytics. Lazy-imported so a broken module here can't crash the catch.
    try {
      import('../lib/sentry').then(({ captureException }) => {
        captureException(error, { componentStack: errorInfo?.componentStack });
      }).catch(() => {});
    } catch { /* swallow */ }
    try {
      import('../lib/analytics').then(({ track }) => {
        track('client_error', {
          message: String(error?.message || error).slice(0, 200),
          stack: String(error?.stack || '').slice(0, 500),
          component_stack: String(errorInfo?.componentStack || '').slice(0, 500),
        });
      }).catch(() => {});
    } catch { /* swallow */ }
  }

  handleReload = () => {
    window.location.reload();
  };

  handleSignOut = async () => {
    try {
      const { signOut } = await import('../lib/auth');
      await signOut();
    } catch { /* swallow */ }
    window.location.href = '/';
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    // Stale chunk → we're reloading to the fresh build; show a calm interstitial
    // (not the scary error screen) for the moment before navigation.
    if (this.state.isChunk) {
      return (
        <div style={{
          minHeight: '100vh', background: C.dark, color: C.steel,
          fontFamily: 'Barlow, sans-serif', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', gap: 14,
        }}>
          <div style={{ fontSize: 40 }}>🏒</div>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 20, color: C.ice, textTransform: 'uppercase' }}>Updating to the latest version…</div>
          <button onClick={this.handleReload} style={{ background: 'transparent', color: C.steel, border: `1px solid ${C.border}`, borderRadius: 999, padding: '8px 18px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Reload now</button>
        </div>
      );
    }
    const isProd = window.location.hostname === 'rinkd.app' || window.location.hostname === 'www.rinkd.app';
    return (
      <div style={{
        minHeight: '100vh', background: C.dark, color: C.ice,
        fontFamily: 'Barlow, sans-serif',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: 24, textAlign: 'center',
      }}>
        <div style={{
          maxWidth: 480, background: C.card,
          border: `1px solid ${C.border}`, borderRadius: 16,
          padding: 32,
        }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🏒</div>
          <div style={{
            fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900,
            fontSize: 28, lineHeight: 1.1, textTransform: 'uppercase', marginBottom: 10,
          }}>
            Something hit the boards
          </div>
          <div style={{ fontSize: 14, color: C.steel, lineHeight: 1.55, marginBottom: 20 }}>
            Rinkd hit an unexpected error. Try reloading — usually that's enough.
            If it keeps happening, drop a note to <a href="mailto:hello@rinkd.app" style={{ color: C.ice, textDecoration: 'underline' }}>hello@rinkd.app</a> and we'll take a look.
          </div>
          {!isProd && this.state.error && (
            <div style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 11, color: C.red,
              background: C.dark, border: '1px solid rgba(215,38,56,0.3)',
              padding: 10, borderRadius: 8, textAlign: 'left',
              marginBottom: 16, overflow: 'auto', maxHeight: 200,
            }}>
              {String(this.state.error?.message || this.state.error)}
              {this.state.errorInfo?.componentStack && (
                <pre style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{this.state.errorInfo.componentStack}</pre>
              )}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={this.handleReload} style={{
              background: C.red, color: '#fff', border: 'none',
              padding: '11px 22px', borderRadius: 999, cursor: 'pointer',
              fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontStyle: 'italic',
              fontSize: 14, letterSpacing: '0.05em', textTransform: 'uppercase',
            }}>
              Reload Rinkd
            </button>
            <button onClick={this.handleSignOut} style={{
              background: 'transparent', color: C.ice,
              border: `1px solid ${C.border}`,
              padding: '11px 22px', borderRadius: 999, cursor: 'pointer',
              fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 600,
            }}>
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }
}
