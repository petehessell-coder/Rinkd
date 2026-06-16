import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import {
  getIntegrationAuthorization,
  recordIntegrationAuthorization,
  revokeIntegrationAuthorization,
} from '../lib/integrationAuthorizations';

// INTEGRATIONS-1 — reusable data-sync authorization clickwrap.
//
// Drop this above any integration's connect UI. It records WHO authorized the
// sync, WHEN, the exact STATEMENT, and a VERSION (integration_authorizations).
// While unauthorized it renders the checkbox + statement; once authorized it
// collapses to a confirmation line. The parent gates its connect form on the
// `onAuthorizedChange(authorized)` callback (or reads the same record itself).
//
// Props:
//   ownerType  - 'league' | 'tournament'
//   ownerId    - the league/tournament id
//   integration- 'hockeyshift' | 'gamesheet' | ...
//   label      - human provider name shown in the statement ('HockeyShift')
//   version    - statement version string (default 'v1')
//   statement  - override the default statement text (optional)
//   accent     - accent color (default Rinkd red)
//   onAuthorizedChange - (authorized: boolean) => void, fired on load + change

const C = {
  ice: '#F4F7FA', steel: '#8BA3BE', card: '#0f2847',
  border: 'rgba(46,91,140,0.4)', green: '#22C55E', red: '#D72638',
};

function defaultStatement(label) {
  return `I authorize Rinkd to sync our ${label} data and confirm we have the right to share it.`;
}

export default function DataSyncAuthorization({
  ownerType, ownerId, integration, label = 'this provider',
  version = 'v1', statement, accent = C.red, onAuthorizedChange,
}) {
  const text = statement || defaultStatement(label);
  const [auth, setAuth] = useState(null);     // the active authorization row, or null
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [me, setMe] = useState(null);

  const notify = useCallback((v) => { onAuthorizedChange?.(v); }, [onAuthorizedChange]);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data }, { data: userRes }] = await Promise.all([
      getIntegrationAuthorization(ownerType, ownerId, integration),
      supabase.auth.getUser(),
    ]);
    setMe(userRes?.user?.id || null);
    setAuth(data);
    setLoading(false);
    notify(!!data);
  }, [ownerType, ownerId, integration, notify]);

  useEffect(() => { load(); }, [load]);

  const authorize = async () => {
    setBusy(true); setError('');
    const { data, error: e } = await recordIntegrationAuthorization({
      ownerType, ownerId, integration, statement: text, version,
    });
    setBusy(false);
    if (e) { setError(e.message || 'Could not record the authorization.'); return; }
    setAuth(data);
    notify(true);
  };

  const revoke = async () => {
    if (!auth) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Revoke the ${label} data-sync authorization? Syncing should be turned off until it's re-authorized.`)) return;
    setBusy(true); setError('');
    const { error: e } = await revokeIntegrationAuthorization(auth.id);
    setBusy(false);
    if (e) { setError(e.message || 'Could not revoke the authorization.'); return; }
    setAuth(null);
    notify(false);
  };

  if (loading) {
    return <div style={{ fontSize: 12, color: C.steel, padding: '8px 0' }}>Checking authorization…</div>;
  }

  if (auth) {
    const when = auth.authorized_at ? new Date(auth.authorized_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
    const byYou = me && auth.authorized_by === me;
    return (
      <div style={{ background: 'rgba(34,197,94,0.08)', border: `1px solid rgba(34,197,94,0.35)`, borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ color: C.green, fontSize: 16 }}>✓</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, color: C.ice, fontWeight: 600 }}>
            {label} data sync authorized{byYou ? ' by you' : ''}{when ? ` · ${when}` : ''}
          </div>
          <div style={{ fontSize: 11, color: C.steel, marginTop: 2 }}>"{text}" ({auth.version})</div>
        </div>
        <button onClick={revoke} disabled={busy}
          style={{ background: 'transparent', color: C.steel, border: `1px solid ${C.border}`, borderRadius: 999, padding: '5px 11px', fontSize: 11, fontWeight: 600, cursor: busy ? 'default' : 'pointer', fontFamily: 'Barlow, sans-serif' }}>
          Revoke
        </button>
      </div>
    );
  }

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: busy ? 'default' : 'pointer' }}>
        <input type="checkbox" checked={false} disabled={busy} onChange={authorize} style={{ marginTop: 2, accentColor: accent, width: 16, height: 16, flexShrink: 0 }} />
        <span style={{ fontSize: 13, color: C.ice, lineHeight: 1.5 }}>{text}</span>
      </label>
      {error && <div style={{ color: C.red, fontSize: 12, marginTop: 8 }}>{error}</div>}
    </div>
  );
}
