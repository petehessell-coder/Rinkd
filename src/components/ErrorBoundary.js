import React from 'react';

/**
 * Top-level error boundary. Without this, any uncaught render error blanks
 * the entire React tree and the user sees a black screen with zero context.
 * With this, they see a branded fallback + Reload button, and we get a clear
 * console log + analytics event to chase the bug.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    // eslint-disable-next-line no-console
    console.error('[Rinkd] Caught error:', error, errorInfo);
    // Best-effort analytics — never throw from inside the catch.
    try {
      // Lazy import so we don't crash if analytics itself is broken
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
    const isProd = window.location.hostname === 'rinkd.app' || window.location.hostname === 'www.rinkd.app';
    return (
      <div style={{
        minHeight: '100vh', background: '#07111F', color: '#F4F7FA',
        fontFamily: 'Barlow, sans-serif',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: 24, textAlign: 'center',
      }}>
        <div style={{
          maxWidth: 480, background: '#0f2847',
          border: '1px solid rgba(46,91,140,0.4)', borderRadius: 16,
          padding: 32,
        }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🏒</div>
          <div style={{
            fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900,
            fontSize: 28, lineHeight: 1.1, textTransform: 'uppercase', marginBottom: 10,
          }}>
            Something hit the boards
          </div>
          <div style={{ fontSize: 14, color: '#8BA3BE', lineHeight: 1.55, marginBottom: 20 }}>
            Rinkd hit an unexpected error. Try reloading — usually that's enough.
            If it keeps happening, drop a note to <a href="mailto:hello@rinkd.app" style={{ color: '#F4F7FA', textDecoration: 'underline' }}>hello@rinkd.app</a> and we'll take a look.
          </div>
          {!isProd && this.state.error && (
            <div style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 11, color: '#D72638',
              background: '#07111F', border: '1px solid rgba(215,38,56,0.3)',
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
              background: '#D72638', color: '#fff', border: 'none',
              padding: '11px 22px', borderRadius: 999, cursor: 'pointer',
              fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontStyle: 'italic',
              fontSize: 14, letterSpacing: '0.05em', textTransform: 'uppercase',
            }}>
              Reload Rinkd
            </button>
            <button onClick={this.handleSignOut} style={{
              background: 'transparent', color: '#F4F7FA',
              border: '1px solid rgba(46,91,140,0.4)',
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
